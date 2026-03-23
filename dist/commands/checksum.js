// ROME-TAG: 0xA0F9B4
import alias from '../utils/alias.js';
const fetch = alias.importUtil('../utils/fetch') || alias.importUtil('@utils/fetch') || globalThis.fetch;
const logger = alias.importUtil('@utils/logger') || alias.importUtil('../utils/logger') || console;
const DAEMON = process.env.QFLUSH_DAEMON || 'http://localhost:4500';
async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    return json;
}
async function getJson(url) {
    const res = await fetch(url);
    const json = await res.json();
    return json;
}
export default async function runChecksum(argv = []) {
    const sub = argv[0];
    if (!sub) {
        logger.info('Usage: qflush checksum <store|verify|list|clear>');
        return 1;
    }
    if (sub === 'store') {
        const id = argv[1];
        const checksum = argv[2];
        const ttlArg = argv.find((a) => a.startsWith('--ttl='));
        const ttlMs = ttlArg ? Number(ttlArg.split('=')[1]) : undefined;
        if (!id || !checksum) {
            logger.error('Usage: qflush checksum store <id> <checksum> [--ttl=ms]');
            return 1;
        }
        const body = { id, checksum };
        if (ttlMs)
            body.ttlMs = ttlMs;
        const res = await postJson(`${DAEMON.replace(/\/$/, '')}/npz/checksum/store`, body);
        logger.info(`store => ${JSON.stringify(res)}`);
        return 0;
    }
    if (sub === 'verify') {
        const id = argv[1];
        const checksum = argv[2];
        if (!id || !checksum) {
            logger.error('Usage: qflush checksum verify <id> <checksum>');
            return 1;
        }
        const res = await postJson(`${DAEMON.replace(/\/$/, '')}/npz/checksum/verify`, { id, checksum });
        if (res && res.success) {
            logger.success('verify: OK');
            return 0;
        }
        logger.error(`verify failed: ${JSON.stringify(res)}`);
        return 2;
    }
    if (sub === 'list') {
        const res = await getJson(`${DAEMON.replace(/\/$/, '')}/npz/checksum/list`);
        logger.info(JSON.stringify(res, null, 2));
        return 0;
    }
    if (sub === 'clear') {
        const res = await fetch(`${DAEMON.replace(/\/$/, '')}/npz/checksum/clear`, { method: 'DELETE' });
        const j = await res.json();
        logger.info(JSON.stringify(j));
        return 0;
    }
    logger.error('Unknown checksum command');
    return 1;
}
