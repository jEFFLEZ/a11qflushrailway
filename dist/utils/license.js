// ROME-TAG: 0x3C04E4
import * as fs from 'fs';
import * as path from 'path';
// do not statically import node-fetch (may be ESM); use dynamic import when needed
const STORE = path.join(process.cwd(), '.qflush', 'license.json');
function ensureDir() {
    const dir = path.dirname(STORE);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
export function readLicense() {
    try {
        if (!fs.existsSync(STORE))
            return null;
        const raw = fs.readFileSync(STORE, 'utf8');
        return JSON.parse(raw);
    }
    catch (e) {
        return null;
    }
}
export function saveLicense(rec) {
    try {
        ensureDir();
        fs.writeFileSync(STORE, JSON.stringify(rec, null, 2), 'utf8');
        return true;
    }
    catch (e) {
        return false;
    }
}
export async function activateLicense(_key, _productId) {
    return { ok: false, error: 'License activation not available' };
}
export default { readLicense, saveLicense, activateLicense };
