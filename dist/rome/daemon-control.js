// ROME-TAG: 0xDC10D8
let reloadHandler = null;
export function setReloadHandler(fn) {
    reloadHandler = fn;
}
export async function callReload() {
    try {
        if (reloadHandler)
            await reloadHandler();
        return true;
    }
    catch (e) {
        return false;
    }
}
export default { callReload, setReloadHandler };
