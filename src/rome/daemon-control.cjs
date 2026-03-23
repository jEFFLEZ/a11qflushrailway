let reloadHandler = null;

function setReloadHandler(fn) {
  reloadHandler = fn;
}

async function callReload() {
  try {
    if (reloadHandler) await reloadHandler();
    return true;
  } catch (e) { return false; }
}

module.exports = { callReload, setReloadHandler };
