import { QFLUSH_MODE } from './qflush-mode.js';
export async function startQflushSystem() {
    if (QFLUSH_MODE !== 'daemon') {
        try {
            const m = await import('../cortex/bus.js');
            if (m && typeof m.startCortexBus === 'function') {
                console.log('[QFLUSH] starting CORTEX bus');
                m.startCortexBus();
            }
        }
        catch (e) {
            console.warn('[QFLUSH] failed to start CORTEX bus (continuing):', String(e));
        }
    }
    if (QFLUSH_MODE !== 'cortex') {
        try {
            const m = await import('../daemon/qflushd.js');
            const mm = m;
            // accept either startServer export or default export function
            const startFn = (mm && typeof mm.startServer === 'function') ? mm.startServer : (mm && typeof mm.default === 'function') ? mm.default : null;
            if (startFn) {
                console.log('[QFLUSH] starting legacy daemon server');
                const port = process.env.QFLUSHD_PORT ? Number(process.env.QFLUSHD_PORT) : undefined;
                startFn(port);
            }
        }
        catch (e) {
            console.warn('[QFLUSH] failed to start legacy daemon (continuing):', String(e));
        }
    }
}
