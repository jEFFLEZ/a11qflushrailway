import colors from './colors.js';
const isProd = process.env.NODE_ENV === 'production';
const _logger = {
    info: (msg, ...rest) => console.log(`\x1b[36m[QFLUSH]\x1b[0m ${msg}`, ...rest),
    warn: (msg, ...rest) => console.log(`\x1b[33m[QFLUSH]\x1b[0m ${msg}`, ...rest),
    error: (msg, ...rest) => console.error(`\x1b[31m[QFLUSH]\x1b[0m ${msg}`, ...rest),
    success: (msg, ...rest) => console.log(`\x1b[32m[QFLUSH]\x1b[0m ${msg}`, ...rest),
    joker: (title, msg) => (colors && colors.styledLog ? colors.styledLog(title, msg, { accent: 'joker' }) : console.log(title, msg)),
    nez: (title, msg) => (colors && colors.styledLog ? colors.styledLog(title, msg, { accent: 'base' }) : console.log(title, msg)),
    neutral: (title, msg) => (colors && colors.styledLog ? colors.styledLog(title, msg, { accent: 'neutral' }) : console.log(title, msg)),
    debug: (...args) => { if (!isProd)
        (console.debug || console.log)(...args); },
};
export const logger = _logger;
export default _logger;
export const info = _logger.info;
export const warn = _logger.warn;
export const error = _logger.error;
export const debug = _logger.debug;
export const success = _logger.success;
