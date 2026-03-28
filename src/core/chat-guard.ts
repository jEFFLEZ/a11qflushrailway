import * as fs from 'node:fs';
import * as path from 'node:path';

export type ChatVerificationIssue = {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  evidence?: string;
};

export type ChatVerificationConfig = {
  enabled: boolean;
  mode: 'report' | 'annotate' | 'strict';
  annotateThreshold: number;
  blockThreshold: number;
  placeholderDomains: string[];
  riskySuccessPhrases: string[];
};

export type ChatVerificationResult = {
  enabled: boolean;
  mode: ChatVerificationConfig['mode'];
  suspicious: boolean;
  shouldAnnotate: boolean;
  shouldBlock: boolean;
  score: number;
  issues: ChatVerificationIssue[];
  summary: string;
};

const DEFAULT_CONFIG: ChatVerificationConfig = {
  enabled: true,
  mode: 'annotate',
  annotateThreshold: 35,
  blockThreshold: 85,
  placeholderDomains: [
    'example.com',
    'example.org',
    'example.net',
    'dummy',
    'localhost',
    '127.0.0.1',
  ],
  riskySuccessPhrases: [
    "c'est fait",
    'c est fait',
    'email envoye',
    'mail envoye',
    'pdf est pret',
    'pdf pret',
    'image est prete',
    'image prete',
    'stocke dans le bucket',
    'lien temporaire',
    'created successfully',
    'email sent',
    'stored successfully',
    'download your file',
  ],
};

function normalizeBoolean(raw: string | undefined, fallback: boolean) {
  if (typeof raw !== 'string') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(raw: string | undefined, fallback: number) {
  const numeric = Number(String(raw || '').trim());
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function parseCsv(raw: string | undefined, fallback: string[]) {
  const items = String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function trim(value: unknown): string {
  return String(value || '').trim();
}

function loadGuardConfigFile(cwd = process.cwd()): Partial<ChatVerificationConfig> {
  const configPath = path.join(cwd, '.qflush', 'llm-guard.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveChatVerificationConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ChatVerificationConfig {
  const fileConfig = loadGuardConfigFile(cwd);
  const requestedMode = trim(String(env.QFLUSH_CHAT_VERIFY_MODE || fileConfig.mode || DEFAULT_CONFIG.mode)).toLowerCase();
  const mode: ChatVerificationConfig['mode'] =
    requestedMode === 'report' || requestedMode === 'annotate' || requestedMode === 'strict'
      ? requestedMode
      : DEFAULT_CONFIG.mode;

  return {
    enabled: normalizeBoolean(env.QFLUSH_CHAT_VERIFY, fileConfig.enabled ?? DEFAULT_CONFIG.enabled),
    mode,
    annotateThreshold: Math.max(1, parseNumber(env.QFLUSH_CHAT_VERIFY_ANNOTATE_THRESHOLD, fileConfig.annotateThreshold ?? DEFAULT_CONFIG.annotateThreshold)),
    blockThreshold: Math.max(1, parseNumber(env.QFLUSH_CHAT_VERIFY_BLOCK_THRESHOLD, fileConfig.blockThreshold ?? DEFAULT_CONFIG.blockThreshold)),
    placeholderDomains: parseCsv(env.QFLUSH_CHAT_VERIFY_PLACEHOLDER_DOMAINS, fileConfig.placeholderDomains ?? DEFAULT_CONFIG.placeholderDomains),
    riskySuccessPhrases: parseCsv(env.QFLUSH_CHAT_VERIFY_SUCCESS_PHRASES, fileConfig.riskySuccessPhrases ?? DEFAULT_CONFIG.riskySuccessPhrases),
  };
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s)\]]+/gi) || [];
  return Array.from(new Set(matches.map((entry) => trim(entry)).filter(Boolean)));
}

function hasStructuredEvidence(text: string) {
  return (
    /https?:\/\//i.test(text)
    || /\b(resource|storage|storageKey|downloadUrl|resourceId|filename|attachment|piece jointe|pi[eè]ce jointe|id[:=])/i.test(text)
  );
}

function normalizeText(text: string) {
  return trim(text).toLowerCase();
}

export function verifyChatOutput(output: string, config: ChatVerificationConfig = resolveChatVerificationConfig()): ChatVerificationResult {
  const text = trim(output);
  if (!config.enabled || !text) {
    return {
      enabled: config.enabled,
      mode: config.mode,
      suspicious: false,
      shouldAnnotate: false,
      shouldBlock: false,
      score: 0,
      issues: [],
      summary: config.enabled ? 'Aucune anomalie détectée.' : 'Vérification désactivée.',
    };
  }

  const issues: ChatVerificationIssue[] = [];
  let score = 0;
  const normalized = normalizeText(text);
  const urls = extractUrls(text);

  for (const url of urls) {
    const lowerUrl = url.toLowerCase();
    const matchedPlaceholder = config.placeholderDomains.find((domain) => lowerUrl.includes(domain.toLowerCase()));
    if (matchedPlaceholder) {
      issues.push({
        code: 'placeholder_url',
        severity: 'error',
        message: `URL placeholder détectée (${matchedPlaceholder}).`,
        evidence: url,
      });
      score += 70;
    }
  }

  if (/allowedactions\.json|tool_results|unknown action|pret a exporter|résultat structure detecte|resultat structure detecte/i.test(text)) {
    issues.push({
      code: 'internal_artifact_leak',
      severity: 'error',
      message: 'La réponse fuit un artefact interne ou un marqueur de tooling.',
    });
    score += 55;
  }

  const mentionsSuccess = config.riskySuccessPhrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
  if (mentionsSuccess && !hasStructuredEvidence(text)) {
    issues.push({
      code: 'success_without_evidence',
      severity: 'warn',
      message: 'Réponse affirmative sans lien, identifiant ou preuve exploitable.',
    });
    score += 35;
  }

  if ((/voici votre pdf|voici ton pdf|t[eé]l[eé]charger le pdf|download the pdf/i.test(text)) && !urls.length) {
    issues.push({
      code: 'download_without_url',
      severity: 'warn',
      message: 'Un téléchargement est annoncé sans URL valide.',
    });
    score += 30;
  }

  if (/image a ete prise par l'utilisateur|assistant en cours de configuration|je ne peux pas afficher d'images directement dans le chat/i.test(normalized)) {
    issues.push({
      code: 'generic_low_confidence_answer',
      severity: 'info',
      message: 'Réponse générique détectée, probablement peu fiable ou peu exploitée.',
    });
    score += 12;
  }

  const suspicious = score >= config.annotateThreshold || issues.some((issue) => issue.severity === 'error');
  const shouldBlock = suspicious && config.mode === 'strict' && score >= config.blockThreshold;
  const shouldAnnotate = suspicious && config.mode === 'annotate';

  return {
    enabled: true,
    mode: config.mode,
    suspicious,
    shouldAnnotate,
    shouldBlock,
    score,
    issues,
    summary: issues.length
      ? issues.map((issue) => issue.message).join(' ')
      : 'Aucune anomalie détectée.',
  };
}

export function annotateChatOutput(output: string, verification: ChatVerificationResult) {
  if (!verification.shouldAnnotate) return output;
  return `[QFLUSH VERIFY] Réponse potentiellement non vérifiée: ${verification.summary}\n\n${output}`;
}
