// ROME-TAG: 0x29A73C
import { exec } from "child_process";
import alias from './alias.js';
const logger = alias.importUtil('@utils/logger') || alias.importUtil('./logger') || console;
import { SERVICE_MAP } from "./paths.js";
import { resolvePackagePath } from "./package.js";
export async function detectModules() {
    const out = {};
    for (const name of Object.keys(SERVICE_MAP))
        out[name] = { running: false, installed: false, path: undefined, bin: undefined };
    for (const name of Object.keys(SERVICE_MAP)) {
        try {
            const pkgName = SERVICE_MAP[name].pkg;
            if (!pkgName)
                continue;
            const pkgPath = resolvePackagePath(pkgName);
            if (pkgPath) {
                out[name].installed = true;
                out[name].path = pkgPath;
                try {
                    const pkgJson = require(require('path').join(pkgPath, 'package.json'));
                    if (pkgJson && pkgJson.bin) {
                        out[name].bin = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
                    }
                }
                catch (err) { /* ignore malformed or missing package.json */ }
            }
        }
        catch (err) { /* ignore resolvePackagePath failures */ }
    }
    await new Promise((resolve) => {
        exec(process.platform === "win32" ? "tasklist" : "ps aux", (err, stdout) => {
            if (err) {
                logger.warn(`Failed to list processes: ${err.message}`);
                return resolve();
            }
            const s = stdout.toString();
            for (const name of Object.keys(SERVICE_MAP)) {
                const regex = new RegExp(name, "i");
                if (regex.test(s)) {
                    out[name].running = true;
                }
            }
            resolve();
        });
    });
    return out;
}
export async function findAndKill() {
    const names = Object.keys(SERVICE_MAP);
    const killed = [];
    for (const n of names) {
        try {
            if (process.platform === "win32") {
                exec(`taskkill /IM ${n}.exe /F`, (err) => { });
            }
            else {
                exec(`pkill -f ${n}`, (err) => { });
            }
        }
        catch (err) {
            /* ignore errors when attempting to spawn pkill/taskkill */
        }
    }
    return killed;
}
