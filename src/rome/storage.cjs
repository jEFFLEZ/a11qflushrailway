const fs = require('fs');
const path = require('path');

function saveEngineHistory(key, ts, p, cmd, res) {
  try {
    const dir = path.join(process.cwd(), '.qflush', 'history');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, String(key) + '.json');
    try { fs.writeFileSync(file, JSON.stringify({ key, ts, path: p, cmd, res }, null, 2), 'utf8'); } catch (e) { }
  } catch (e) { }
}

module.exports = { saveEngineHistory };
