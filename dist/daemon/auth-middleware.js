function getExpectedToken() {
    if (process.env.QFLUSH_TOKEN)
        return process.env.QFLUSH_TOKEN;
    // Mode test/CI : token toujours présent
    if (process.env.VITEST_WORKER_ID || process.env.QFLUSH_SAFE_CI === '1') {
        return 'test-token';
    }
    return null;
}
export function requireQflushToken(req, res, next) {
    const token = getExpectedToken();
    const given = req.headers['x-qflush-token'] || req.query['token'] || req.body?.token;
    // Mauvaise config (prod) → 401
    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'QFLUSH_TOKEN not configured on server',
        });
    }
    // Token incorrect → 401
    if (given !== token) {
        return res.status(401).json({
            success: false,
            error: 'invalid token',
        });
    }
    return next();
}
// ROME-TAG: 0x92EED4
