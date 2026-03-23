import { describe, it, expect } from 'vitest';
import { applyCortexPacket } from './applyPacket.js';
import * as fs from 'fs';
import * as path from 'path';
describe('applyPacket handlers', () => {
    it('applies oc8 metadata', async () => {
        const tmp = path.join(process.cwd(), '.qflush', 'test-oc8');
        try {
            if (!fs.existsSync(path.dirname(tmp)))
                fs.mkdirSync(path.dirname(tmp), { recursive: true });
        }
        catch (e) { }
        const pkt = { type: 'cortex:oc8', id: 't-oc8-1', payload: { info: { name: 'OC8TEST', description: 'test' } } };
        await applyCortexPacket(pkt);
        const out = path.join(process.cwd(), '.qflush', 'oc8.meta.json');
        expect(fs.existsSync(out)).toBe(true);
        const j = JSON.parse(fs.readFileSync(out, 'utf8'));
        expect(j.name).toBe('OC8TEST');
    });
    it('applies auto-patch dry-run and does not write config', async () => {
        const cfg = path.join(process.cwd(), '.qflush', 'config.json');
        try {
            if (fs.existsSync(cfg))
                fs.unlinkSync(cfg);
        }
        catch (e) { }
        const pkt = { type: 'cortex:auto-patch', id: 't-patch-1', payload: { patch: { flags: { testMode: true } }, dryRun: true } };
        await applyCortexPacket(pkt);
        expect(fs.existsSync(cfg)).toBe(false);
    });
});
