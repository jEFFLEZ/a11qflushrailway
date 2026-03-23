/* ROME-TAG: 0xF45330 */
import alias from '../utils/alias.js';
const logger = alias.importUtil('@utils/logger') || alias.importUtil('../utils/logger') || console;
import gumroad from '../utils/gumroad-license.js';
export async function runLicense(argv = []) {
    const sub = argv[0];
    if (!sub) {
        logger.info('Usage: qflush license status | clear');
        return 1;
    }
    if (sub === 'activate') {
        logger.error('License activation is not available in this build.');
        return 1;
    }
    if (sub === 'status') {
        const rec = gumroad.loadLicense();
        if (!rec) {
            logger.info('No local license found');
            return 0;
        }
        logger.info(`Local license: key=${rec.key} product=${rec.product_id} expires=${rec.expiresAt ? new Date(rec.expiresAt).toISOString() : 'never'}`);
        return 0;
    }
    if (sub === 'clear') {
        gumroad.clearLicense();
        logger.info('Local license cleared');
        return 0;
    }
    logger.info('Unknown license command');
    return 1;
}
