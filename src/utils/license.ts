// ROME-TAG: 0x3C04E4

import * as fs from 'fs';
import * as path from 'path';
// do not statically import node-fetch (may be ESM); use dynamic import when needed

const STORE = path.join(process.cwd(), '.qflush', 'license.json');

export type LicenseRecord = {
  key: string;
  product_id?: string;
  valid?: boolean;
  expires_at?: string | null;
  verifiedAt?: number;
};

function ensureDir() {
  const dir = path.dirname(STORE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readLicense(): LicenseRecord | null {
  try {
    if (!fs.existsSync(STORE)) return null;
    const raw = fs.readFileSync(STORE, 'utf8');
    return JSON.parse(raw) as LicenseRecord;
  } catch (e) {
    return null;
  }
}

export function saveLicense(rec: LicenseRecord) {
  try {
    ensureDir();
    fs.writeFileSync(STORE, JSON.stringify(rec, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

export async function activateLicense(_key: string, _productId?: string) {
  return { ok: false, error: 'License activation not available' };
}

export default { readLicense, saveLicense, activateLicense };
