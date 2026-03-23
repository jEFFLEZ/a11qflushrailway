// ROME-TAG: 0x2037A4
// Lightweight daemon reload handler
let reloadHandler = null;
export function setReloadHandler(fn) {
    reloadHandler = fn;
}
export function triggerReload() {
    if (reloadHandler)
        reloadHandler();
}
