import * as fs from 'fs';
import * as path from 'path';
const ROUTES_PATH = path.join(process.cwd(), '.qflush', 'cortex.routes.json');
export function loadRoutesConfig() {
    try {
        if (!fs.existsSync(ROUTES_PATH))
            return null;
        const raw = fs.readFileSync(ROUTES_PATH, 'utf8') || '{}';
        const parsed = JSON.parse(raw);
        // support two shapes: { routes: [...] } or { cortexActions: { name: true } } or object map
        if (parsed && parsed.routes && Array.isArray(parsed.routes)) {
            const out = {};
            for (const r of parsed.routes)
                out[r] = { enabled: true, score: 0 };
            return out;
        }
        if (parsed && parsed.cortexActions && typeof parsed.cortexActions === 'object' && !Array.isArray(parsed.cortexActions)) {
            const out = {};
            for (const [k, v] of Object.entries(parsed.cortexActions)) {
                if (typeof v === 'boolean')
                    out[k] = { enabled: v, score: 0 };
                else
                    out[k] = v;
            }
            return out;
        }
        if (parsed && typeof parsed === 'object') {
            // assume mapping directly
            return parsed;
        }
        return null;
    }
    catch (e) {
        return null;
    }
}
export function isRouteEnabled(name) {
    try {
        const cfg = loadRoutesConfig();
        if (!cfg)
            return true; // default allow
        const entry = cfg[name];
        if (!entry)
            return true;
        if (typeof entry.enabled === 'boolean')
            return entry.enabled;
        return true;
    }
    catch (e) {
        return true;
    }
}
export function getRouteScore(name) {
    try {
        const cfg = loadRoutesConfig();
        if (!cfg)
            return 0;
        const entry = cfg[name];
        if (!entry)
            return 0;
        const s = Number(entry.score || 0);
        return Number.isFinite(s) ? s : 0;
    }
    catch (e) {
        return 0;
    }
}
export function pickBestRoute(candidates) {
    if (!candidates || !candidates.length)
        return null;
    const scores = candidates.map(n => ({ name: n, score: getRouteScore(n) }));
    // filter enabled
    const enabled = scores.filter(s => isRouteEnabled(s.name));
    if (!enabled.length)
        return null;
    enabled.sort((a, b) => b.score - a.score);
    return enabled[0].name;
}
export default { loadRoutesConfig, isRouteEnabled, getRouteScore, pickBestRoute };
