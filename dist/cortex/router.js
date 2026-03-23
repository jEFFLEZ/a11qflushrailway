import alias from '../utils/alias.js';
const noopHandler = async () => { return; };
function resolveImport(name) {
    try {
        const g = globalThis || global;
        if (g && typeof g.__importUtilMock === 'function')
            return g.__importUtilMock(name);
    }
    catch (e) { }
    // If the import looks like a relative path, prefer Node's `require` so
    // that module caching and test spies (vitest/vi) work as expected.
    try {
        if (name && (name.startsWith('.') || name.startsWith('/'))) {
            try {
                return require(name);
            }
            catch (e) { /* fallthrough to alias */ }
        }
    }
    catch (e) { }
    try {
        return alias.importUtil(name);
    }
    catch (e) { }
    try {
        // try require as a last resort (for non-relative module names)
        return require(name);
    }
    catch (e) { }
    return undefined;
}
// helper wrappers that resolve modules at call time (so tests can mock resolveImport via global)
async function safeExecuteAction(action, ctx = {}) {
    try {
        const executorMod = resolveImport('../rome/executor') || resolveImport('@rome/executor') || resolveImport('src/rome/executor') || resolveImport('../rome/executor');
        if (!executorMod)
            return { success: false, error: 'executor_unavailable' };
        const fn = executorMod.executeAction || (executorMod.default && executorMod.default.executeAction) || executorMod;
        if (typeof fn !== 'function')
            return { success: false, error: 'executeAction_unavailable' };
        return await fn(action, ctx);
    }
    catch (e) {
        return { success: false, error: String(e) };
    }
}
async function safeRunSpyder(argv = []) {
    try {
        const runSpyderMod = resolveImport('../commands/spyder') || resolveImport('@commands/spyder') || resolveImport('src/commands/spyder');
        if (!runSpyderMod)
            return { code: null, error: 'spyder_unavailable' };
        const fn = runSpyderMod.default || runSpyderMod;
        if (typeof fn !== 'function')
            return { code: null, error: 'spyder_run_unavailable' };
        return await fn(argv);
    }
    catch (e) {
        return { code: null, error: String(e) };
    }
}
function safeEmit(eventName, payload) {
    try {
        // In test 'cortex' mode we avoid writing drip logs or emitting events.
        if (process.env.QFLUSH_MODE === 'cortex')
            return false;
        const emitMod = resolveImport('./emit') || resolveImport('@cortex/emit') || resolveImport('src/cortex/emit');
        if (!emitMod)
            return false;
        const fn = emitMod.cortexEmit || (emitMod.default && emitMod.default.cortexEmit) || emitMod;
        if (typeof fn !== 'function')
            return false;
        fn(eventName, payload);
        return true;
    }
    catch (e) {
        return false;
    }
}
async function safeProcessVision(p) {
    try {
        const visionMod = resolveImport('./vision') || resolveImport('@cortex/vision') || resolveImport('src/cortex/vision');
        if (!visionMod)
            return { ok: false, error: 'vision_unavailable' };
        const fn = visionMod.processVisionImage || (visionMod.default && visionMod.default.processVisionImage);
        if (typeof fn !== 'function')
            return { ok: false, error: 'vision_fn_unavailable' };
        return await fn(p && p.path ? p.path : (p && p.pngPath ? p.pngPath : p));
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
}
async function safeApplyPacket(pkt) {
    try {
        const applyMod = resolveImport('./applyPacket') || resolveImport('@cortex/applyPacket') || resolveImport('src/cortex/applyPacket');
        if (!applyMod)
            return { ok: false, error: 'apply_unavailable' };
        const fn = applyMod.applyCortexPacket || (applyMod.default && applyMod.default.applyCortexPacket) || (applyMod.default && applyMod.default.default) || applyMod.default || applyMod;
        if (typeof fn !== 'function')
            return { ok: false, error: 'apply_fn_unavailable' };
        return await fn(pkt);
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
}
// Handlers
const handlers = {
    'cortex:npz-graph': async (pkt) => {
        const filePath = pkt.payload && pkt.payload.path ? pkt.payload.path : 'unknown';
        const res = await safeExecuteAction('npz.encode', { path: filePath });
        // if executor not available, behave as noop for tests
        if (res && res.success === false && res.error === 'executor_unavailable')
            return undefined;
        return res;
    },
    'npz-graph': async (pkt) => {
        const filePath = pkt.payload && pkt.payload.path ? pkt.payload.path : 'unknown';
        const res = await safeExecuteAction('npz.encode', { path: filePath });
        if (res && res.success === false && res.error === 'executor_unavailable')
            return undefined;
        return res;
    },
    'cortex:drip': async (pkt) => {
        const ok = safeEmit('CORTEX-DRIP', pkt.payload);
        // if emit not available, behave as noop for tests
        if (!ok)
            return undefined;
        return { ok };
    },
    'cortex:enable-spyder': async (pkt) => {
        try {
            const cfg = pkt.payload || {};
            const args = Array.isArray(cfg.args) && cfg.args.length ? cfg.args : ['start'];
            const res = await safeRunSpyder(args);
            return { ok: true, res };
        }
        catch (e) {
            return { ok: false, error: String(e) };
        }
    },
    'cortex:spyder-vision': async (pkt) => {
        return await safeProcessVision(pkt.payload);
    },
    'spyder-vision': async (pkt) => {
        return await safeProcessVision(pkt.payload);
    },
    'vision': async (pkt) => {
        return await safeProcessVision(pkt.payload);
    },
    'cortex:a11-suggest': async (pkt, services) => {
        try {
            if (!services || !services.a11)
                return { ok: false, error: 'a11_service_missing' };
            const prompt = pkt.payload && pkt.payload.prompt ? pkt.payload.prompt : 'Provide a short refactor plan.';
            const resp = await services.a11.ask(prompt);
            return { ok: true, suggestion: resp };
        }
        catch (e) {
            return { ok: false, error: String(e) };
        }
    },
    // apply-related handlers
    'cortex:apply': async (pkt) => {
        return await safeApplyPacket(pkt);
    },
    'qflush:apply': async (pkt) => {
        return await safeApplyPacket(pkt);
    },
    // save state and auto-patch forward to apply logic
    'cortex:save-state': async (pkt) => { return await safeApplyPacket(pkt); },
    'save-state': async (pkt) => { return await safeApplyPacket(pkt); },
    'save:state': async (pkt) => { return await safeApplyPacket(pkt); },
    'auto-patch': async (pkt) => { return await safeApplyPacket(pkt); },
    'auto_patch': async (pkt) => { return await safeApplyPacket(pkt); },
    'auto-patch:apply': async (pkt) => { return await safeApplyPacket(pkt); },
    'auto_patch:apply': async (pkt) => { return await safeApplyPacket(pkt); },
};
// normalize and lookup function
function findHandler(pkt) {
    const candidates = [];
    if (pkt.type)
        candidates.push(String(pkt.type));
    if (pkt.payload && typeof pkt.payload === 'object') {
        if (typeof pkt.payload.cmd === 'string')
            candidates.push(String(pkt.payload.cmd));
        if (typeof pkt.payload.command === 'string')
            candidates.push(String(pkt.payload.command));
    }
    // add lowercase variants
    for (const c of candidates.slice())
        candidates.push(c.toLowerCase());
    for (const c of candidates) {
        const key = String(c || '').toLowerCase();
        if (handlers[key])
            return handlers[key];
    }
    // fallback to routesCfg pick logic if present
    try {
        const routesCfg = resolveImport('./routesConfig') || resolveImport('@cortex/routesConfig') || resolveImport('src/cortex/routesConfig');
        if (routesCfg && typeof routesCfg.pickBestRoute === 'function') {
            const pick = routesCfg.pickBestRoute(candidates);
            if (pick) {
                const k = String(pick).toLowerCase();
                if (handlers[k])
                    return handlers[k];
            }
        }
    }
    catch (e) { }
    return noopHandler;
}
export async function routeCortexPacket(packet, services) {
    const h = findHandler(packet);
    try {
        return await h(packet, services);
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
}
export default { routeCortexPacket };
