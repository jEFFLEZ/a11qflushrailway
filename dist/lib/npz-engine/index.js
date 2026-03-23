// ROME-TAG: 0x1D49C5
import engine from '../../utils/npz-engine.js';
export function getScores() {
    const store = engine.getStore();
    return Object.values(store).map((r) => ({ laneId: r.laneId, score: r.score, lastSuccess: r.lastSuccess, lastFailure: r.lastFailure }));
}
export function resetScores() {
    engine.resetScores();
}
export function getOrderedLanes(lanes) {
    return engine.orderLanesByScore(lanes);
}
export default { getScores, resetScores, getOrderedLanes };
