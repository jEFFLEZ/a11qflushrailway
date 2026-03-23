// ROME-TAG: 0x41A515
import client from 'prom-client';
client.collectDefaultMetrics();
export function metricsMiddleware() {
    const registry = client.register;
    return async function (req, res, next) {
        if (req.path === '/metrics') {
            res.set('Content-Type', registry.contentType);
            res.send(await registry.metrics());
            return;
        }
        next();
    };
}
export default metricsMiddleware;
