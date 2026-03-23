export function getQflushMode() {
    const env = (process.env.QFLUSH_MODE || '').toString().trim().toLowerCase();
    if (env === 'daemon' || env === 'cortex' || env === 'hybrid')
        return env;
    // When running tests prefer cortex for faster, portless execution
    if (process.env.VITEST)
        return 'cortex';
    // default to hybrid to allow smooth migration
    return 'hybrid';
}
export const QFLUSH_MODE = getQflushMode();
