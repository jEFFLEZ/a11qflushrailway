// ROME-TAG: 0xC4BE64
import * as fs from 'fs';
import * as path from 'path';
const DEFAULT_STORAGE = path.join(process.cwd(), '.qflush', 'license.json');
function getStoragePath() {
    return DEFAULT_STORAGE;
}
function ensureDir(storagePath) {
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
export function saveLicense(rec) {
    const storage = getStoragePath();
    ensureDir(storage);
    fs.writeFileSync(storage, JSON.stringify(rec, null, 2), 'utf8');
}
export function loadLicense() {
    try {
        const storage = getStoragePath();
        if (!fs.existsSync(storage))
            return null;
        const raw = fs.readFileSync(storage, 'utf8');
        return JSON.parse(raw);
    }
    catch (e) {
        return null;
    }
}
export function isLicenseValid(rec) {
    if (!rec)
        return false;
    if (rec.expiresAt && Date.now() > rec.expiresAt)
        return false;
    return true;
}
export async function activateLicense(_product_id, _licenseKey, _token) {
    throw new Error('License activation not available');
}
export function clearLicense() {
    try {
        const storage = getStoragePath();
        if (fs.existsSync(storage))
            fs.unlinkSync(storage);
    }
    catch (e) { }
}
export default { saveLicense, loadLicense, activateLicense, isLicenseValid, clearLicense };
