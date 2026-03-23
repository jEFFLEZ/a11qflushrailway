// ROME-TAG: 0x332555
import express from 'express';
import npzStore from './npz-store.js';
import npzRouter from './npz-router.js';
import engine from './npz-engine.js';
import { stringify } from 'csv-stringify/sync';
import { isAdminAuthorized } from './auth.js';
const router = express.Router();
function requireToken(req, res, next) {
    if (!isAdminAuthorized(req))
        return res.status(401).json({ error: 'unauthorized' });
    next();
}
router.use('/npz', requireToken);
router.get('/npz/inspect/:id', async (req, res) => {
    const r = await npzStore.getRequestRecord(req.params.id);
    res.json(r || { error: 'not found' });
});
router.get('/npz/lanes', (req, res) => {
    res.json(npzRouter.DEFAULT_LANES);
});
router.get('/npz/preferred/:host', (req, res) => {
    const host = req.params.host;
    const pref = npzRouter.getPreferredLane(host);
    res.json({ host, preferred: pref });
});
router.get('/npz/circuit/:host', (req, res) => {
    const host = req.params.host;
    const state = npzRouter.getCircuitState(host);
    res.json(state);
});
// Admin scores endpoint
router.get('/npz/scores', (req, res) => {
    try {
        const store = engine.getStore();
        const items = Object.values(store).map((r) => ({ laneId: r.laneId, score: r.score, lastSuccess: r.lastSuccess, lastFailure: r.lastFailure }));
        items.sort((a, b) => a.score - b.score);
        res.json(items);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
router.post('/npz/scores/reset', (req, res) => {
    try {
        engine.resetScores();
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
router.get('/npz/scores.csv', (req, res) => {
    try {
        const store = engine.getStore();
        const items = Object.values(store).map((r) => ({ laneId: r.laneId, score: r.score, lastSuccess: r.lastSuccess, lastFailure: r.lastFailure }));
        items.sort((a, b) => a.score - b.score);
        const csv = stringify(items, { header: true });
        res.set('Content-Type', 'text/csv');
        res.send(csv);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
export default router;
