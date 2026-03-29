// ROME-TAG: 0xF73710

import { detectModules } from "../utils/detect.js";
import logger from "../utils/logger.js";
import { ensurePackageInstalled, pathExists, rebuildInstructionsFor } from "../utils/exec.js";
import { resolvePaths, SERVICE_MAP } from "../utils/paths.js";
import { qflushOptions } from "../chain/smartChain.js";
import { resolvePackagePath, readPackageJson } from "../utils/package.js";
import { startProcess } from "../supervisor/index.js";
import { waitForService } from "../utils/health.js";
import { runCustomsCheck, hasBlockingIssues, ModuleDescriptor } from "../utils/npz-customs.js";
import { resolveMerged } from "../supervisor/merged-resolver.js";
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { startService } from '../services/index.js';
import net from 'node:net';

// Read SPYDER admin port from config/env with sensible fallback
function getSpyderAdminPort(): number {
  try {
    // 1) explicit env override
    const envPort = process.env.QFLUSH_SPYDER_ADMIN_PORT;
    if (envPort) {
      const p = Number(envPort);
      if (!Number.isNaN(p) && p > 0 && Number.isFinite(p)) return p;
    }

    // 2) .qflush/spyder.config.json (project-local config)
    try {
      const spyCfgPath = path.join(process.cwd(), '.qflush', 'spyder.config.json');
      if (fs.existsSync(spyCfgPath)) {
        const raw = fs.readFileSync(spyCfgPath, 'utf8');
        const cfg = JSON.parse(raw || '{}');
        if (cfg && typeof cfg.adminPort === 'number' && cfg.adminPort > 0) return cfg.adminPort;
        if (cfg && typeof cfg.adminPort === 'string') {
          const p = Number(cfg.adminPort);
          if (!Number.isNaN(p) && p > 0) return p;
        }
      }
    } catch (err) {
      console.warn('[start] failed to read .qflush/spyder.config.json:', err);
    }

    // 3) .qflush/logic-config.json fallback (older config location)
    try {
      const logicCfg = path.join(process.cwd(), '.qflush', 'logic-config.json');
      if (fs.existsSync(logicCfg)) {
        const raw2 = fs.readFileSync(logicCfg, 'utf8');
        const lc = JSON.parse(raw2 || '{}');
        if (lc && (typeof lc.spyderAdminPort === 'number')) return lc.spyderAdminPort;
        if (lc && (typeof lc.spyderAdminPort === 'string')) {
          const p = Number(lc.spyderAdminPort);
          if (!Number.isNaN(p) && p > 0) return p;
        }
      }
    } catch (err) {
      console.warn('[start] failed to read .qflush/logic-config.json:', err);
    }

  } catch (_) {}

  // default
  return 4001;
}

// Check whether a TCP port on host is accepting connections
async function isPortInUse(host: string, port: number, timeout = 400): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
    try {
      const s = net.createConnection({ host, port, timeout }, () => {
        try { s.destroy(); } catch (err) { console.warn('[start] isPortInUse destroy failed:', err); }
        resolve(true);
      });
      s.on('error', () => resolve(false));
      s.on('timeout', () => { try { s.destroy(); } catch (err) { console.warn('[start] isPortInUse destroy on timeout failed:', err); } ; resolve(false); });
    } catch (e) { resolve(false); }
  });
}

// Persist chosen spyder admin port into .qflush/spyder.config.json and .qflush/spyder.env
function persistSpyderAdminPort(spyPort: number) {
  try {
    const qflushDir = path.join(process.cwd(), '.qflush');
    if (!fs.existsSync(qflushDir)) fs.mkdirSync(qflushDir, { recursive: true });
    // ensure logs dir exists to avoid ENOENT when processes open log files
    try { if (!fs.existsSync(path.join(qflushDir, 'logs'))) fs.mkdirSync(path.join(qflushDir, 'logs'), { recursive: true }); } catch (e) { /* ignore */ }
    const spyCfgPath = path.join(qflushDir, 'spyder.config.json');
    let needWrite = false;
    let spyCfg: any = {};
    if (fs.existsSync(spyCfgPath)) {
      try {
        spyCfg = JSON.parse(fs.readFileSync(spyCfgPath, 'utf8') || '{}');
      } catch (_) { spyCfg = {}; }
      if (!spyCfg.adminPort) {
        spyCfg.adminPort = spyPort;
        needWrite = true;
      }
    } else {
      spyCfg = { adminPort: spyPort };
      needWrite = true;
    }
    if (needWrite) {
      try {
        fs.writeFileSync(spyCfgPath, JSON.stringify(spyCfg, null, 2), 'utf8');
        logger.info(`Wrote .qflush/spyder.config.json with adminPort ${spyPort}`);
      } catch (e) {
        logger.warn(`Failed to write .qflush/spyder.config.json: ${e}`);
      }
    }
    try {
      const spyEnvPath = path.join(qflushDir, 'spyder.env');
      const envContent = `SPYDER_ADMIN_PORT=${spyCfg.adminPort}\n`;
      fs.writeFileSync(spyEnvPath, envContent, 'utf8');
      logger.info(`Wrote .qflush/spyder.env with SPYDER_ADMIN_PORT=${spyCfg.adminPort}`);
    } catch (e) {
      logger.warn(`Failed to write .qflush/spyder.env: ${e}`);
    }
  } catch (e) {
    logger.warn(`Failed to persist spyder admin port: ${e}`);
  }
}

// Ensure a package at prefixPath has build artifacts, try to build if missing
export async function ensureBuiltIfNeeded(prefixPath: string): Promise<boolean> {
  try {
    const npmBuild = process.platform === 'win32'
      ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', '--prefix'] as string[] }
      : { cmd: 'npm', args: ['--prefix'] as string[] };
    const candidates = [
      prefixPath,
      path.join(prefixPath, 'spyder'),
      path.join(prefixPath, 'apps', 'spyder-core')
    ];

    for (const cand of candidates) {
      const distEntry = path.join(cand, 'dist', 'index.js');
      if (fs.existsSync(distEntry)) {
        return true;
      }
    }

    // Try to build candidates that have a build script
    for (const cand of candidates) {
      try {
        const pkgJsonPath = path.join(cand, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;
        const pj = readPackageJson(cand);
        if (!pj || !pj.scripts || !pj.scripts.build) continue;

        logger.info(`Local package at ${cand} missing dist; running build...`);
        const r = spawnSync(npmBuild.cmd, [...npmBuild.args, cand, 'run', 'build'], { stdio: 'inherit' });
        if (r.status === 0) {
          const distEntry = path.join(cand, 'dist', 'index.js');
          if (fs.existsSync(distEntry)) return true;
        }
      } catch (e) {
        // continue trying other candidates
      }
    }

    logger.warn(`No build artifact found under ${prefixPath} or subpackages`);
    return false;
  } catch (e) {
    logger.warn(`ensureBuiltIfNeeded failed: ${e}`);
    return false;
  }
}

// Start a module using customs/local package resolution and merged resolver fallback
export async function startWithCustoms(modName: string, optsParam?: qflushOptions, pathsParam?: Record<string,string|undefined>) {
  const p = (optsParam?.modulePaths && optsParam.modulePaths[modName]) || (pathsParam && pathsParam[modName]);
  const pkg = SERVICE_MAP[modName] && SERVICE_MAP[modName].pkg;

  const modDesc: ModuleDescriptor = { name: modName, pkg, cwd: p || process.cwd() };

  // run customs
  const report = await runCustomsCheck(modDesc);
  if (hasBlockingIssues(report)) {
    logger.warn(`supervisor: ${modName} blocked at customs, not starting.`);
    return;
  }

  // if an explicit path is provided, prefer to run it directly
  if (p) {
    try {
      const pkgJson = readPackageJson(p);
      if (pkgJson && pkgJson.bin) {
        const binEntry = typeof pkgJson.bin === "string" ? pkgJson.bin : Object.values(pkgJson.bin)[0];
        const binPath = path.join(p, binEntry);

        // if bin exists and is a JS file, run via node; otherwise try to run directly but fallback to node if not executable
        let runCmd = null as any;
        if (pathExists(binPath) && binPath.endsWith('.js')) {
          runCmd = { cmd: process.execPath, args: [binPath], cwd: p };
        } else if (pathExists(binPath)) {
          // check executable bit on POSIX; on Windows assume runnable
          let isExec = true;
          try {
            if (process.platform !== 'win32') {
              const st = fs.statSync(binPath);
              isExec = !!(st.mode & 0o111);
            }
          } catch (e) { isExec = false; }

          if (isExec) {
            runCmd = { cmd: binPath, args: [], cwd: p };
          } else {
            // fallback: attempt to run with node
            runCmd = { cmd: process.execPath, args: [binPath], cwd: p };
          }
        }

        // if no bin but there is a start script, prefer npm --prefix <p> run start
        if (!runCmd && pkgJson && pkgJson.scripts && pkgJson.scripts.start) {
          runCmd = { cmd: 'npm', args: ['--prefix', p, 'run', 'start'], cwd: p };
        }

        // If runCmd still not set or dist missing, try common subpackage locations
        if (!runCmd) {
          const subCandidates = ['spyder', 'apps/spyder-core'];
          for (const sub of subCandidates) {
            try {
              const subPkg = path.join(p, sub);
              const subPkgJsonPath = path.join(subPkg, 'package.json');
              if (fs.existsSync(subPkgJsonPath)) {
                const subPkgJson = readPackageJson(subPkg);
                if (subPkgJson && subPkgJson.scripts && subPkgJson.scripts.start) {
                  runCmd = { cmd: 'npm', args: ['--prefix', subPkg, 'run', 'start'], cwd: subPkg };
                  break;
                }
              }
            } catch (_) {}
          }
        }

        if (runCmd) {
          // if runCmd is npm start with prefix, ensure build exists
          if (runCmd.cmd === 'npm' && runCmd.args.includes('run') && runCmd.args.includes('start')) {
            const ok = await ensureBuiltIfNeeded(p);
            if (!ok) return;
          }

          logger.info(`Launching ${modName} -> ${runCmd.cmd} ${runCmd.args.join(" ")}`);
          startProcess(modName, runCmd.cmd, runCmd.args, { cwd: runCmd.cwd });
          return;
        }
      }
    } catch (e) {
      logger.warn(`Failed to run local path for ${modName}: ${e}`);
    }
  }

  // otherwise, use merged resolver (supervisor + NPZ) as primary
  if (pkg) {
    const resolved = await resolveMerged(pkg);
    if (!resolved) {
      logger.warn(`${modName} path and package not found or merged resolver failed to resolve, skipping`);
      return;
    }

    if (resolved.gate === 'dlx') {
      const ok = ensurePackageInstalled(pkg);
      if (!ok) {
        logger.warn(`${modName} not found and failed to install ${pkg}, skipping`);
        return;
      }
    }

    const runCmd = { cmd: resolved.cmd as string, args: resolved.args || [], cwd: resolved.cwd };
    logger.info(`Launching ${modName} -> ${runCmd.cmd} ${runCmd.args.join(" ")}`);
    startProcess(modName, runCmd.cmd, runCmd.args, { cwd: runCmd.cwd });
    return;
  }

  logger.warn(`${modName} has no runnable entry, skipping`);
}

// Resolve a runnable command for a package path. Returns null if none found.
export async function resolveRunCommandForPackage(mod: string, pkgPath: string, pkgJson: any): Promise<{ cmd: string; args: string[]; cwd?: string; buildPrefix?: string } | null> {
  if (!pkgPath) return null;

  // 1) package bin entry
  if (pkgJson?.bin) {
    const binEntry = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
    const binPath = path.join(pkgPath, binEntry);
    if (binPath.endsWith('.js') && pathExists(binPath)) {
      return { cmd: process.execPath, args: [binPath], cwd: pkgPath };
    }
    if (pathExists(binPath)) {
      let isExec = true;
      try {
        if (process.platform !== 'win32') {
          const st = fs.statSync(binPath);
          isExec = !!(st.mode & 0o111);
        }
      } catch (e) { isExec = false; }
      if (isExec) return { cmd: binPath, args: [], cwd: pkgPath };
      return { cmd: process.execPath, args: [binPath], cwd: pkgPath };
    }
    logger.warn(`${mod} bin entry not found at ${binPath}. ${rebuildInstructionsFor(pkgPath)}`);
  }

  // 2) package main entry for internal packages published without bin/start
  if (pkgJson?.main) {
    const mainEntry = path.join(pkgPath, pkgJson.main);
    if (pathExists(mainEntry)) {
      return { cmd: process.execPath, args: [mainEntry], cwd: pkgPath };
    }
  }

  // 3) package start script
  if (pkgJson?.scripts?.start) {
    return { cmd: 'npm', args: ['--prefix', pkgPath, 'run', 'start'], cwd: pkgPath, buildPrefix: pkgPath };
  }

  // 4) try common subpackage locations
  const subCandidates = ['spyder', 'apps/spyder-core'];
  for (const sub of subCandidates) {
    try {
      const subPkg = path.join(pkgPath, sub);
      const subPkgJsonPath = path.join(subPkg, 'package.json');
      if (fs.existsSync(subPkgJsonPath)) {
        const subPkgJson = readPackageJson(subPkg);
        if (subPkgJson?.main) {
          const subMainEntry = path.join(subPkg, subPkgJson.main);
          if (pathExists(subMainEntry)) {
            return { cmd: process.execPath, args: [subMainEntry], cwd: subPkg };
          }
        }
        if (subPkgJson?.scripts?.start) {
          return { cmd: 'npm', args: ['--prefix', subPkg, 'run', 'start'], cwd: subPkg, buildPrefix: subPkg };
        }
      }
    } catch (_) {}
  }

  // 5) fallback to merged resolver will be handled by caller
  return null;
}

// Spawn the process via supervisor and optionally wait for health or a short delay.
export function spawnAndWait(mod: string, runCmd: { cmd: string; args: string[]; cwd?: string }, waitForStart: boolean, flags: any): Promise<void> {
  return new Promise((resolve) => {
    logger.info(`Launching ${mod} -> ${runCmd.cmd} ${runCmd.args.join(" ")}`);

    // use supervisor to manage and persist process
    try {
      startProcess(mod, runCmd.cmd, runCmd.args, { cwd: runCmd.cwd });
    } catch (e) {
      logger.warn(`Failed to start ${mod}: ${e}`);
      resolve();
      return;
    }

    if (waitForStart) {
      const svcUrl = flags["health-url"] || flags["health"];
      const svcPort = flags["health-port"] || undefined;
      if (svcUrl) {
        waitForService(svcUrl as string, svcPort as any).then((ok) => {
          if (ok) logger.success(`${mod} passed health check`);
          else logger.warn(`${mod} failed health check`);
          resolve();
        }).catch(() => resolve());
      } else {
        setTimeout(() => {
          logger.info(`${mod} started (delayed wait).`);
          resolve();
        }, 2000);
      }
    } else {
      resolve();
    }
  });
}

// Top-level helper to start SPYDER resonnance if configured
export async function startSpyderResonnanceIfConfigured() {
  try {
    const spyCfgPath = path.join(process.cwd(), '.qflush', 'spyder.config.json');
    if (fs.existsSync(spyCfgPath)) {
      try {
        const raw = fs.readFileSync(spyCfgPath, 'utf8');
        const spyCfg = JSON.parse(raw || '{}');
        if (spyCfg && spyCfg.enabled) {
          try {
            const m: any = await import('../cortex/resonnance.js');
            const startFn = (m && typeof m.resonnance === 'function') ? m.resonnance : (m && typeof m.default === 'function' ? m.default : null);
            if (startFn) {
              const p = startFn();
              if (p && typeof p.then === 'function') p.catch((e: any) => logger.warn('SPYDER resonnance failed: ' + String(e)));
              logger.info('SPYDER resonnance started as part of qflush start');
            } else {
              logger.warn('SPYDER resonnance module found but no callable export');
            }
          } catch (e) {
            logger.warn('Failed to import/start SPYDER resonnance: ' + String(e));
          }
        }
      } catch (e) {
        logger.warn('Failed to read or parse spyder.config.json: ' + String(e));
      }
    }

    // Also, if cortex.routes.json contains routes, start resonnance (makes SPYDER active when routes present)
    const routesPath = path.join(process.cwd(), '.qflush', 'cortex.routes.json');
    if (fs.existsSync(routesPath)) {
      try {
        const rawRoutes = fs.readFileSync(routesPath, 'utf8') || '{}';
        const parsed = JSON.parse(rawRoutes);
        const routesArr = parsed && (parsed.routes || parsed.cortexActions) ? (parsed.routes || parsed.cortexActions) : null;
        let count = 0;
        if (Array.isArray(routesArr)) count = routesArr.length;
        else if (routesArr && typeof routesArr === 'object') count = Object.keys(routesArr).length;
        if (count > 0) {
          try {
            const m: any = await import('../cortex/resonnance.js');
            const startFn = (m && typeof m.resonnance === 'function') ? m.resonnance : (m && typeof m.default === 'function' ? m.default : null);
            if (startFn) {
              const p = startFn();
              if (p && typeof p.then === 'function') p.catch((e: any) => logger.warn('SPYDER resonnance failed: ' + String(e)));
              logger.info('SPYDER resonnance started because cortex.routes.json contains routes');
            }
          } catch (e) {
            logger.warn('Failed to import/start SPYDER resonnance from cortex.routes: ' + String(e));
          }
        }
      } catch (e) {
        logger.warn('Failed to read or parse cortex.routes.json: ' + String(e));
      }
    }
  } catch (e) {
    logger.warn('Failed to start SPYDER resonnance checks: ' + String(e));
  }
}

// Probe SPYDER admin port and persist configuration; returns false if port is occupied (skip)
async function probeAndPersistSpyderPort(): Promise<boolean> {
  const spyPort = getSpyderAdminPort();
  try {
    const inUse = await isPortInUse('127.0.0.1', spyPort);
    if (inUse) {
      logger.warn(`Skipping start of spyder: admin port ${spyPort} already in use`);
      return false;
    }
    // best-effort persist
    persistSpyderAdminPort(spyPort);
    return true;
  } catch (e) {
    logger.warn(`Failed to probe/persist spyder admin port: ${e}`);
    // allow start attempt if probe fails
    return true;
  }
}

// Resolve a runnable command either from local package (resolveRunCommandForPackage)
// or via merged resolver (and install if necessary). Returns null if nothing resolved.
async function resolveOrMergedRunCmd(mod: string, pkg: string | undefined, pkgPath: string | undefined, pkgJson: any) {
  // prefer local package resolution
  const local = await resolveRunCommandForPackage(mod, pkgPath || '', pkgJson);
  if (local) return local;

  if (!pkg) return null;

  const resolved = await resolveMerged(pkg);
  if (!resolved) return null;

  if (resolved.gate === 'dlx') {
    const ok = ensurePackageInstalled(pkg);
    if (!ok) return null;
  }

  return { cmd: resolved.cmd as string, args: resolved.args || [], cwd: resolved.cwd };
}

// Resolve package path and package.json for a module, installing if necessary.
// Returns { pkgPath, pkg, pkgJson } where pkgPath may be null when not found.
async function resolvePackagePathForModule(mod: string, opts: qflushOptions | undefined, paths: Record<string,string|undefined>) {
  const p = opts?.modulePaths?.[mod] || paths[mod];
  const pkg = SERVICE_MAP[mod]?.pkg;

  let pkgPath = p;
  if (!pkgPath && pkg) pkgPath = resolvePackagePath(pkg);

  if (!pkgPath && pkg) {
    const ok = ensurePackageInstalled(pkg);
    if (!ok) return { pkgPath: null, pkg, pkgJson: null };
    pkgPath = resolvePackagePath(pkg);
  }

  if (!pkgPath) return { pkgPath: null, pkg, pkgJson: null };
  const pkgJson = readPackageJson(pkgPath);
  return { pkgPath, pkg, pkgJson };
}

// Ensure build (if requested) and start the runnable command via supervisor
async function startRunnable(mod: string, runCmd: { cmd: string; args: string[]; cwd?: string; buildPrefix?: string } | undefined, waitForStart: boolean, flags: any): Promise<void> {
  if (!runCmd) return;

  if (runCmd.buildPrefix) {
    const ok = await ensureBuiltIfNeeded(runCmd.buildPrefix);
    if (!ok) {
      logger.warn(`${mod} build step failed, skipping start`);
      return;
    }
  }

  await spawnAndWait(mod, runCmd, waitForStart, flags);
}

// Start a single module (extracted from runStart to reduce complexity)
export async function startModule(mod: string, opts: qflushOptions | undefined, paths: Record<string,string|undefined>, flags: any, waitForStart: boolean) {
  // If embed mode is enabled, use startService
  const embed = process.env.QFLUSH_EMBED_SERVICES === '1';
  if (embed) {
    // For spyder in embed mode: probe and persist port config (if free), then start via service
    if (mod === 'spyder') {
      await probeAndPersistSpyderPort();
    }
    try {
      await startService(mod, { flags });
      return;
    } catch (e) {
      logger.warn(`embedded start failed for ${mod}: ${e}`);
      return;
    }
  }

  if (mod === 'spyder') {
    const ok = await probeAndPersistSpyderPort();
    if (!ok) return;
  }
  const resolved = await resolvePackagePathForModule(mod, opts, paths);
  if (!resolved.pkgPath) {
    // fallback to customs+merged-resolver flow
    await startWithCustoms(mod, opts, paths);
    return;
  }
  const { pkgPath, pkg: pkgName, pkgJson } = resolved;
  const runCmd = await resolveOrMergedRunCmd(mod, pkgName, pkgPath, pkgJson);
  if (!runCmd) {
    logger.warn(`${mod} has no runnable entry, skipping`);
    return;
  }

  await startRunnable(mod, runCmd, waitForStart, flags);
}

export async function runStart(opts?: qflushOptions) {
  logger.info("qflush: starting modules...");

  // ensure .qflush and logs dir exist early to avoid races when starting services
  try {
    const qflushDir = path.join(process.cwd(), '.qflush');
    if (!fs.existsSync(qflushDir)) fs.mkdirSync(qflushDir, { recursive: true });
    const logsDir = path.join(qflushDir, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  } catch (e) {
    logger.warn(`Failed to ensure .qflush/logs before start: ${e}`);
  }

  // Respect CI/dev flag to disable supervisor starting external services
  const disableSupervisor = process.env.QFLUSH_DISABLE_SUPERVISOR === '1' || String(process.env.QFLUSH_DISABLE_SUPERVISOR).toLowerCase() === 'true';
  if (disableSupervisor) {
    logger.warn('QFLUSH supervisor disabled via QFLUSH_DISABLE_SUPERVISOR, skipping start of external modules');
    return;
  }

  const detected = opts?.detected || (await detectModules());
  const paths = resolvePaths(detected);

  const services = opts?.services?.length ? opts.services : Object.keys(SERVICE_MAP);
  const flags = opts?.flags || {};

  const waitForStart = Boolean(flags["wait"] || flags["--wait"] || false);

  const procs: Promise<void>[] = [];

  // ensureBuiltIfNeeded moved to top-level export

  // startWithCustoms moved to top-level export

  for (const mod of services) {
    procs.push(startModule(mod, opts, paths, flags, waitForStart));
  }

  await Promise.all(procs);
  await startSpyderResonnanceIfConfigured();

  logger.success("qflush: start sequence initiated for selected modules");
}

