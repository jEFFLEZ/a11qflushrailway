import * as path from 'path';
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Repo root
const ROOT = path.resolve(__dirname, "../..");
function local(...segments) {
    return path.join(ROOT, ...segments);
}
export const SERVICE_MAP = {
    spyder: {
        name: "spyder",
        candidates: [
            local("src/spyder"),
            local("spyder/apps/spyder-core"),
            "node_modules/@funeste38/spyder",
        ],
        entry: "dist/index.js",
    },
    qflush: {
        name: "qflush",
        candidates: [local("dist")],
        entry: "index.js",
    },
    cortex: {
        name: "cortex",
        candidates: [local("src/cortex")],
        entry: "index.ts",
    },
};
export default SERVICE_MAP;
