// ROME-TAG: 0x9C32F0
import { detectModules } from "../utils/detect.js";
import { logger } from "../utils/logger.js";
export async function runDetect(_opts) {
    logger.info("qflush: detecting modules...");
    const detected = await detectModules();
    for (const k of Object.keys(detected)) {
        const v = detected[k];
        logger.info(`${k}: ${v.running ? 'running' : 'stopped'}`);
    }
    // return a normalized object
    return { detected, paths: {} };
}
