import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('cortex/router handlers', () => {
    beforeEach(() => { try {
        vi.restoreAllMocks();
        delete globalThis.__importUtilMock;
    }
    catch (e) { } });
    it('npz-graph handler calls executor', async () => {
        const fakeExec = { executeAction: vi.fn(async (a, b) => ({ success: true, action: a, ctx: b })) };
        globalThis.__importUtilMock = (name) => {
            if (name.includes('executor'))
                return fakeExec;
            return undefined;
        };
        const router = await import('./router.js');
        const pkt = { type: 'cortex:npz-graph', payload: { path: 'some/path' } };
        const res = await router.routeCortexPacket(pkt);
        expect(res && res.success).toBe(true);
        expect(fakeExec.executeAction.mock.calls.length).toBeGreaterThan(0);
    });
    it('vision handler calls vision.processVisionImage', async () => {
        const fakeVision = { processVisionImage: vi.fn(async (p) => ({ ok: true, path: p })) };
        globalThis.__importUtilMock = (name) => {
            if (name.includes('vision'))
                return fakeVision;
            return undefined;
        };
        const router = await import('./router.js');
        const pkt = { type: 'cortex:spyder-vision', payload: { path: 'img.png' } };
        const res = await router.routeCortexPacket(pkt);
        expect(res && res.ok).toBe(true);
        expect(fakeVision.processVisionImage.mock.calls.length).toBe(1);
    });
    it('apply handler calls applyCortexPacket', async () => {
        const fakeApply = { applyCortexPacket: vi.fn(async (p) => ({ ok: true })) };
        globalThis.__importUtilMock = (name) => {
            if (name.includes('applyPacket'))
                return fakeApply;
            return undefined;
        };
        const router = await import('./router.js');
        const pkt = { type: 'qflush:apply', payload: { patch: {} } };
        const res = await router.routeCortexPacket(pkt);
        expect(res && res.ok).toBe(true);
        expect(fakeApply.applyCortexPacket.mock.calls.length).toBe(1);
    });
});
