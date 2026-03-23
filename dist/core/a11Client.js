import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
const CFG = path.join(process.cwd(), '.qflush', 'a11.config.json');
export function readConfig() {
    if (!fs.existsSync(CFG))
        return null;
    try {
        return JSON.parse(fs.readFileSync(CFG, 'utf8'));
    }
    catch (e) {
        return null;
    }
}
export async function a11Chat(prompt, options) {
    const cfg = readConfig();
    if (!cfg || !cfg.enabled)
        throw new Error('A-11 not configured');
    const model = options?.model || cfg.defaultModel;
    const body = { model, messages: [{ role: 'user', content: prompt }], stream: false };
    const url = (cfg.serverUrl || 'http://127.0.0.1:3000').replace(/\/$/, '') + '/v1/chat';
    const timeoutMs = Number(cfg.timeoutMs) || 60000;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        if (!res.ok)
            throw new Error('A-11 chat failed: ' + res.status);
        return await res.json();
    }
    finally {
        clearTimeout(to);
    }
}
export async function a11Health() {
    const cfg = readConfig();
    if (!cfg)
        return { ok: false };
    const url = (cfg.serverUrl || 'http://127.0.0.1:3000').replace(/\/$/, '') + '/v1/health';
    const timeoutMs = Number(cfg.timeoutMs) || 60000;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text };
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
    finally {
        clearTimeout(to);
    }
}
