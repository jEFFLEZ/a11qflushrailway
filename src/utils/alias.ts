import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// avoid static import of './paths' to prevent TypeScript module resolution issues in some environments
let resolvePaths: any = undefined;
try {
  // require at runtime; if not available, leave undefined
  // use dynamic path to avoid TypeScript module resolution of literal './paths'
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p = require(path.join(__dirname, 'paths'));
  resolvePaths = p && p.resolvePaths;
} catch (e) {
  resolvePaths = undefined;
}

const isTest = process.env.NODE_ENV === 'test';
function warn(...args: any[]) { if (!isTest) console.warn(...args); }

function tryRequire(filePath: string) {
  try {
    if (fs.existsSync(filePath)) return require(filePath);
  } catch (e) {
    try { return require(filePath); } catch (e) { return undefined; }
  }
  return undefined;
}

function tryRequireVariants(basePath: string) {
  const variants = [".js", ".ts", "/index.js", "/index.ts"];
  for (const v of variants) {
    const p = basePath.endsWith(v) ? basePath : basePath + v;
    const m = tryRequire(p);
    if (m) return (m && m.default) || m;
  }
  return undefined;
}

export function importUtil(name: string): any {
  // normalize alias forms such as '@utils/foo' or '#utils/foo' to a simple local name
  let localName = name;
  const aliasMatch = name && (name.startsWith('@utils/') || name.startsWith('#utils/'));
  if (aliasMatch) localName = name.replace(/^(@|#)?utils\//, '');

  // prefer spyder local workspace copy when present
  try {
    if (aliasMatch && typeof resolvePaths === 'function') {
      const paths = resolvePaths();
      const spy = paths && paths['spyder'];
      if (spy) {
        // common locations inside spyder package layout
        const candidates = [
          path.join(spy, 'apps', 'spyder-core', 'src', 'utils', localName),
          path.join(spy, 'apps', 'spyder-core', 'src', localName),
          path.join(spy, 'src', 'utils', localName),
          path.join(spy, 'src', localName),
          path.join(spy, 'utils', localName),
        ];
        for (const c of candidates) {
          const m = tryRequireVariants(c);
          if (m) return m;
        }
        // try requiring from spyder root via Node resolution (works if spyder is a package)
        try {
          const resolved = require.resolve(localName, { paths: [spy] });
          const m = require(resolved);
          if (m) return (m && m.default) || m;
        } catch (e: any) {
          if (e?.code !== 'MODULE_NOT_FOUND') {
            warn('[alias] require.resolve from spyder failed', String(e));
          }
        }
      }
    }
  } catch (e) {
    warn('[alias] resolvePaths check failed', String(e));
  }

  // If name was an alias like @utils/foo, try local src/utils/<foo>
  if (aliasMatch) {
    try {
      const local = tryRequireVariants(path.join(__dirname, localName));
      if (local) return local;
    } catch (e) { warn('[alias] tryRequireVariants local failed', String(e)); }
  }

  // fallback: if a relative path or module name was passed, try requiring directly
  try {
    // try direct file/module
    const m1 = tryRequire(name);
    if (m1) return (m1 && m1.default) || m1;
  } catch (e) { warn('[alias] tryRequire direct failed', String(e)); }

  // last resort: require by name (could be from node_modules)
  try {
    const m = require(name);
    return (m && m.default) || m;
  } catch (e) { warn('[alias] final require failed', String(e)); }

  // try to return a local minimal logger fallback to reduce noisy warnings
  try {
    const fallback = tryRequireVariants(path.join(__dirname, 'logger'));
    if (fallback) return fallback;
  } catch (e) { warn('[alias] fallback logger require failed', String(e)); }

  return undefined;
}

export default { importUtil };
