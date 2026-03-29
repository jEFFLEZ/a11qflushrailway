// ROME-TAG: 0xF2B208

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { CopilotConfig, TelemetryEvent, EngineState, RuleEvent, Diagnostic } from './copilot-types.js';
import { saveTelemetryEvent } from './storage.js';

async function resolveFetch() {
  if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch;
  try {
    const m = await import('node-fetch');
    return (m && (m as any).default) || m;
  } catch (e) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const undici = require('undici');
      if (undici && typeof undici.fetch === 'function') return undici.fetch;
    } catch (_) {}
  }
  return undefined;
}

const DEFAULT_CONFIG: CopilotConfig = {
  enabled: false,
  telemetryVersion: 1,
  transports: ['file'],
  filePath: '.qflush/telemetry.json',
  allowedData: ['engineState','ruleEvent','diagnostic','contextSnapshot'],
  samplingRate: 1.0,
  maxPayloadSize: 200000
};

let cfg: CopilotConfig = DEFAULT_CONFIG;
const emitter = new EventEmitter();

// Respect environment flags to forcibly disable Copilot/telemetry
const ENV_DISABLE_COPILOT =
  process.env.QFLUSH_DISABLE_COPILOT === '1' ||
  String(process.env.QFLUSH_DISABLE_COPILOT).toLowerCase() === 'true' ||
  process.env.QFLUSH_TELEMETRY === '0';

const ENV_ENABLE_COPILOT =
  process.env.QFLUSH_ENABLE_COPILOT === '1' ||
  String(process.env.QFLUSH_ENABLE_COPILOT).toLowerCase() === 'true' ||
  process.env.QFLUSH_COPILOT_ENABLED === '1' ||
  String(process.env.QFLUSH_COPILOT_ENABLED).toLowerCase() === 'true';

function parseListEnv(value?: string | null) {
  return String(value || '')
    .split(/[;,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function applyEnvOverrides() {
  const webhookUrl =
    String(
      process.env.QFLUSH_COPILOT_WEBHOOK_URL ||
      process.env.SLACK_WEBHOOK_URL ||
      process.env.COPILOT_WEBHOOK_URL ||
      process.env.WEBHOOK_URL ||
      ''
    ).trim();
  const transports = parseListEnv(process.env.QFLUSH_COPILOT_TRANSPORTS);
  const filePath = String(process.env.QFLUSH_COPILOT_FILE_PATH || '').trim();
  const allowedData = parseListEnv(process.env.QFLUSH_COPILOT_ALLOWED_DATA);
  const hmacSecretEnv = String(process.env.QFLUSH_COPILOT_HMAC_SECRET_ENV || '').trim();
  const samplingRate = Number(process.env.QFLUSH_COPILOT_SAMPLING_RATE || '');
  const maxPayloadSize = Number(process.env.QFLUSH_COPILOT_MAX_PAYLOAD_SIZE || '');

  if (ENV_ENABLE_COPILOT) {
    cfg.enabled = true;
  }
  if (webhookUrl) {
    cfg.webhookUrl = webhookUrl;
    if (!cfg.transports.includes('webhook')) {
      cfg.transports = Array.from(new Set([...(cfg.transports || []), 'webhook']));
    }
  }
  if (transports.length) {
    cfg.transports = transports.filter((entry): entry is 'webhook'|'sse'|'file' =>
      entry === 'webhook' || entry === 'sse' || entry === 'file'
    );
  }
  if (filePath) {
    cfg.filePath = filePath;
  }
  if (allowedData.length) {
    cfg.allowedData = allowedData;
  }
  if (hmacSecretEnv) {
    cfg.hmacSecretEnv = hmacSecretEnv;
  }
  if (Number.isFinite(samplingRate) && samplingRate > 0) {
    cfg.samplingRate = samplingRate;
  }
  if (Number.isFinite(maxPayloadSize) && maxPayloadSize > 0) {
    cfg.maxPayloadSize = maxPayloadSize;
  }

  if (cfg.enabled && !cfg.transports.length) {
    cfg.transports = ['file'];
  }
}

function loadCfg() {
  try {
    const p = path.join(process.cwd(), '.qflush', 'copilot.json');
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      cfg = Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } else {
      cfg = Object.assign({}, DEFAULT_CONFIG);
    }
  } catch (e) {
    cfg = Object.assign({}, DEFAULT_CONFIG);
  }

  applyEnvOverrides();

  if (ENV_DISABLE_COPILOT) {
    cfg.enabled = false;
  }
}

function isSlackIncomingWebhook(url?: string | null) {
  const value = String(url || '').trim().toLowerCase();
  return value.startsWith('https://hooks.slack.com/services/');
}

function truncateSlackText(value: unknown, maxLength = 2800) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildSlackWebhookPayload(event: TelemetryEvent) {
  const type = String(event?.type || 'telemetry').trim();
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
  const source = truncateSlackText(payload?.source || payload?.service || 'qflush', 80);
  const severity = truncateSlackText(payload?.severity || '', 40);
  const summary =
    truncateSlackText(payload?.message || payload?.summary || payload?.ruleId || type, 1000) ||
    `${type} event`;
  const context = truncateSlackText(JSON.stringify(payload), 1400);
  const titleBits = ['QFLUSH'];
  if (severity) titleBits.push(severity.toUpperCase());
  titleBits.push(type);
  const lines = [
    `*${titleBits.join(' · ')}*`,
    source ? `Source: ${source}` : '',
    `Message: ${summary}`,
    context ? `Context: \`${context}\`` : '',
  ].filter(Boolean);
  return { text: lines.join('\n') };
}

async function sendWebhook(event: TelemetryEvent) {
  if (!cfg.enabled) return;
  if (!cfg.webhookUrl) return;
  let timeout: NodeJS.Timeout | null = null;
  try {
    const payload = JSON.stringify(
      isSlackIncomingWebhook(cfg.webhookUrl)
        ? buildSlackWebhookPayload(event)
        : event
    );
    const headers: any = { 'Content-Type': 'application/json' };
    const fetch = await resolveFetch();
    if (!fetch) return;
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(cfg.webhookUrl, {
      method: 'POST',
      body: payload,
      headers,
      signal: controller.signal as any,
    } as any);
    clearTimeout(timeout);
    timeout = null;
    if (response && 'ok' in response && !response.ok) {
      throw new Error(`slack_webhook_failed:${(response as any).status}`);
    }
  } catch (e) {
    // Keep telemetry strictly best-effort and never block qflush behavior.
    console.warn('[QFLUSH][COPILOT] webhook delivery skipped:', e instanceof Error ? e.message : String(e));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function writeFileEvent(event: TelemetryEvent) {
  try {
    if (!cfg.enabled) return;
    const p = path.join(process.cwd(), cfg.filePath || '.qflush/telemetry.json');
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = p + '.tmp';
    const arr = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8') || '[]') : [];
    arr.push(event);
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch (e) {
    // ignore
  }
}

export function initCopilotBridge() {
  loadCfg();
  if (!cfg.enabled) return;
  // Log explicite de la config webhook au démarrage
  console.log('[QFLUSH][COPILOT] Telemetry enabled:', cfg.enabled, '| webhookUrl:', cfg.webhookUrl, '| transports:', cfg.transports);
}

export async function emitEngineState(state: EngineState) {
  if (!cfg.enabled) return;
  const ev: TelemetryEvent = { type: 'engine_state', telemetryVersion: cfg.telemetryVersion, timestamp: new Date().toISOString(), payload: state };
  if (cfg.transports.includes('webhook')) await sendWebhook(ev);
  if (cfg.transports.includes('file')) writeFileEvent(ev);
  try { saveTelemetryEvent('engine-'+Date.now(), 'engine_state', Date.now(), state); } catch (e) {}
  emitter.emit('telemetry', ev);
}

export async function emitRuleEvent(ev: RuleEvent) {
  if (!cfg.enabled) return;
  const event: TelemetryEvent = { type: 'rule_event', telemetryVersion: cfg.telemetryVersion, timestamp: new Date().toISOString(), payload: ev };
  if (cfg.transports.includes('webhook')) await sendWebhook(event);
  if (cfg.transports.includes('file')) writeFileEvent(event);
  try { saveTelemetryEvent('rule-'+Date.now(), 'rule_event', Date.now(), ev); } catch (e) {}
  emitter.emit('telemetry', event);
}

export async function emitDiagnostic(diag: Diagnostic & { user?: string; context?: any; stack?: string }) {
  if (!cfg.enabled) return;
  // Ajoute le maximum d'infos dans le payload
  const payload = {
    ...diag,
    user: diag.user || (typeof process !== 'undefined' && process.env.USER) || null,
    context: diag.context || {},
    stack: diag.stack || (diag instanceof Error ? diag.stack : undefined) || undefined,
    hostname: (typeof process !== 'undefined' && process.env.HOSTNAME) || undefined,
    cwd: (typeof process !== 'undefined' && process.cwd && process.cwd()) || undefined,
    timestamp: diag.timestamp || new Date().toISOString(),
  };
  const event: TelemetryEvent = { type: 'diagnostic', telemetryVersion: cfg.telemetryVersion, timestamp: new Date().toISOString(), payload };
  if (cfg.transports.includes('webhook')) await sendWebhook(event);
  if (cfg.transports.includes('file')) writeFileEvent(event);
  try { saveTelemetryEvent('diag-'+Date.now(), 'diagnostic', Date.now(), payload); } catch (e) {}
  emitter.emit('telemetry', event);
}

export function onTelemetry(cb: (ev: TelemetryEvent)=>void) { emitter.on('telemetry', cb); }

export function shutdownCopilotBridge() { /* placeholder for flush */ }

export function getConfig() { return cfg; }
