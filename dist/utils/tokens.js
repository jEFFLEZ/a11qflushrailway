// ROME-TAG: 0xD439BD
import { randomBytes } from "crypto";
export function generateToken(len = 24) {
    return randomBytes(len).toString("hex");
}
export function resolveTokens(existing = {}) {
    const out = {};
    for (const name of ["A-11", "SPYDER", "BAT", "KEYKEY", "NEZLEPHANT"]) {
        out[name] = existing[name] || generateToken(12);
    }
    return out;
}
