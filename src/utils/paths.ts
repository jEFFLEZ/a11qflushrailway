// ROME-TAG: 0x1609C0

import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

function candidateBases() {
  const bases = [process.cwd(), REPO_ROOT];
  return Array.from(new Set(bases.filter(Boolean)));
}

// Map service names to npm package names and local folder candidates
export type ServiceInfo = { pkg?: string; candidates?: string[] };

export const SERVICE_MAP: Record<string, ServiceInfo> = {
  rome: { pkg: "@funeste38/rome", candidates: ["./rome", "./Rome"] },
  nezlephant: { pkg: "@funeste38/nezlephant", candidates: ["./nezlephant", "./Nezlephant"] },
  envaptex: { pkg: "@funeste38/envaptex", candidates: ["./envaptex", "./Envaptex"] },
  freeland: { pkg: "@funeste38/freeland", candidates: ["./freeland", "./Freeland"] },
  bat: { pkg: "@funeste38/bat", candidates: ["./bat", "./BAT"] },
  // Prefer the local `./spyder` folder first so local development is picked up before any installed package
  spyder: { pkg: "@funeste38/spyder", candidates: ["./spyder", "./spyder/apps/spyder-core", "./spyder/spyder"] },
};

export function resolvePaths(detected: any = {}) {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(SERVICE_MAP)) {
    // Prefer local candidate folders from the current project first, then
    // fall back to the qflush repo itself so tests and external invocations
    // still resolve bundled modules such as ./spyder.
    const tries = SERVICE_MAP[key].candidates || [];
    let found: string | undefined;
    for (const base of candidateBases()) {
      for (const t of tries) {
        const p = join(base, t);
        if (existsSync(p)) {
          found = p;
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      out[key] = found;
      continue;
    }

    // Fallback to detected package path (e.g., node_modules resolution)
    if (detected && detected[key] && detected[key].path) {
      out[key] = detected[key].path;
      continue;
    }

    // allow environment override for spyder
    if (key === 'spyder' && process.env.SPYDER_ROOT) {
      out[key] = process.env.SPYDER_ROOT;
      continue;
    }
  }
  return out;
}

export default { SERVICE_MAP, resolvePaths };
