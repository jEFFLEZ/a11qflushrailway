// ROME-TAG: 0xEB40C5
import { spawn } from "child_process";
import { logger } from "./logger.js";
import { unlinkSync, existsSync, rmSync } from "fs";
import { execSync } from "child_process";
export function spawnSafe(command, args = [], opts = {}) {
    try {
        const proc = spawn(command, args, { stdio: "inherit", shell: true, ...opts });
        proc.on("error", (err) => logger.error(`Process error: ${err.message}`));
        return proc;
    }
    catch (err) {
        logger.error(`Failed to spawn ${command}: ${err.message}`);
        throw err;
    }
}
export function rimrafSync(path) {
    if (!path)
        return;
    if (!existsSync(path))
        return;
    try {
        rmSync(path, { recursive: true, force: true });
    }
    catch (err) {
        // fallback
        try {
            unlinkSync(path);
        }
        catch (err2) {
            logger.warn(`[exec] rimrafSync fallback unlink failed: ${err2}`);
        }
    }
}
export function isPackageInstalled(pkgName) {
    try {
        execSync(`npm ls ${pkgName} --depth=0`, { stdio: "ignore" });
        return true;
    }
    catch (error_) {
        logger.warn && logger.warn(`[exec] isPackageInstalled check failed for ${pkgName}: ${String(error_)}`);
        return false;
    }
}
export function ensurePackageInstalled(pkgName) {
    if (isPackageInstalled(pkgName))
        return true;
    // In CI or when explicitly requested, avoid attempting global npm installs
    const skipInstalls = process.env.QFLUSH_SKIP_GLOBAL_INSTALLS === '1' || process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    if (skipInstalls) {
        logger.info(`Skipping global install of ${pkgName} (CI or skip flag set)`);
        return false;
    }
    logger.info(`Installing missing package ${pkgName}...`);
    try {
        execSync(`npm install -g ${pkgName}`, { stdio: "inherit" });
        return true;
    }
    catch (err) {
        logger.warn(`Failed to install ${pkgName}: ${err.message}`);
        return false;
    }
}
// Helpers for CLI pre-launch checks
export function pathExists(pathStr) {
    return !!pathStr && existsSync(pathStr);
}
export function rebuildInstructionsFor(pkgPath) {
    if (!pkgPath)
        return `Rebuild the package (cd <pkg> && npm install && npm run build && npm install -g .)`;
    return `Rebuild the package:\n  cd ${pkgPath}\n  npm install\n  npm run build\n  npm install -g .`;
}
