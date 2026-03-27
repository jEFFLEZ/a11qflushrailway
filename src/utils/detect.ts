// ROME-TAG: 0x29A73C

import { exec, spawnSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import alias from './alias.js';
const logger = alias.importUtil('@utils/logger') || alias.importUtil('./logger') || console;
import { SERVICE_MAP } from "./paths.js";
import { readPackageJson, resolvePackagePath } from "./package.js";

const QFLUSH_STATE_DIR = join(process.cwd(), ".qflush");
const QFLUSH_DAEMON_STATE_PATH = join(QFLUSH_STATE_DIR, "daemon.json");
const DEFAULT_QFLUSHD_PORT = 43421;

type QflushDaemonState = {
  pid?: number;
  port?: number;
  startedAt?: string;
};

function readQflushDaemonState(): QflushDaemonState | null {
  try {
    if (!existsSync(QFLUSH_DAEMON_STATE_PATH)) {
      return null;
    }

    const raw = readFileSync(QFLUSH_DAEMON_STATE_PATH, "utf8");
    return JSON.parse(raw) as QflushDaemonState;
  } catch (err) {
    logger.warn(`Failed to read qflush daemon state: ${String(err)}`);
    return null;
  }
}

async function probeQflushHealth(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isPidAlive(pid?: number): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findWindowsPidListeningOnPort(port: number): Promise<number | undefined> {
  return await new Promise<number | undefined>((resolve) => {
    exec("netstat -ano -p tcp", { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(undefined);
        return;
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        const normalized = line.replace(/\s+/g, " ");
        if (!normalized.includes(`:${port} `) || !normalized.includes("LISTENING")) {
          continue;
        }

        const parts = normalized.split(" ");
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) {
          resolve(pid);
          return;
        }
      }

      resolve(undefined);
    });
  });
}

export async function detectModules() {
  const out: Record<string, any> = {};
  for (const name of Object.keys(SERVICE_MAP))
    out[name] = { running: false, installed: false, path: undefined, bin: undefined };

  out.qflushd = {
    running: false,
    installed: true,
    path: process.cwd(),
    bin: "dist/daemon/qflushd.js",
    pid: undefined,
    port: undefined
  };

  for (const name of Object.keys(SERVICE_MAP)) {
    try {
      const pkgName = SERVICE_MAP[name].pkg;
      if (!pkgName) continue;
      const pkgPath = resolvePackagePath(pkgName);
      if (pkgPath) {
        out[name].installed = true;
        out[name].path = pkgPath;
        try {
          const pkgJson = readPackageJson(pkgPath);
          if (pkgJson && pkgJson.bin) {
            out[name].bin = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
          }
        } catch (err) { /* ignore malformed or missing package.json */ }
      }
    } catch (err) { /* ignore resolvePackagePath failures */ }
  }

  await new Promise<void>((resolve) => {
    exec(process.platform === "win32" ? "tasklist" : "ps aux", (err, stdout) => {
      if (err) {
        logger.warn(`Failed to list processes: ${err.message}`);
        return resolve();
      }
      const s = stdout.toString();
      for (const name of Object.keys(SERVICE_MAP)) {
        const regex = new RegExp(name, "i");
        if (regex.test(s)) {
          out[name].running = true;
        }
      }
      resolve();
    });
  });

  const daemonState = readQflushDaemonState();
  const daemonPort = daemonState?.port || Number(process.env.QFLUSHD_PORT) || DEFAULT_QFLUSHD_PORT;
  const discoveredPid =
    daemonState?.pid || (process.platform === "win32" ? await findWindowsPidListeningOnPort(daemonPort) : undefined);
  const daemonRunning = (discoveredPid ? isPidAlive(discoveredPid) : false) || (await probeQflushHealth(daemonPort));

  out.qflushd.running = daemonRunning;
  out.qflushd.pid = discoveredPid;
  out.qflushd.port = daemonPort;

  return out;
}

export async function findAndKill() {
  const names = Object.keys(SERVICE_MAP);
  const killed: number[] = [];

  const daemonState = readQflushDaemonState();
  const daemonPid = daemonState?.pid;
  const daemonPort = daemonState?.port || Number(process.env.QFLUSHD_PORT) || DEFAULT_QFLUSHD_PORT;
  const fallbackPid =
    !daemonPid && process.platform === "win32" ? await findWindowsPidListeningOnPort(daemonPort) : undefined;
  const pidToKill = daemonPid || fallbackPid;

  if (pidToKill && isPidAlive(pidToKill)) {
    try {
      if (process.platform === "win32") {
        const result = spawnSync("taskkill", ["/PID", String(pidToKill), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        });
        if (typeof result.status === "number" && result.status !== 0) {
          throw new Error(`taskkill exited with code ${result.status}`);
        }
      } else {
        process.kill(pidToKill, "SIGTERM");
      }
      killed.push(pidToKill);
    } catch (err) {
      logger.warn(`Failed to stop qflush daemon pid ${pidToKill}: ${String(err)}`);
    }
  }

  for (const n of names) {
    try {
      if (process.platform === "win32") {
        exec(`taskkill /IM ${n}.exe /F`, (err) => {});
      } else {
        exec(`pkill -f ${n}`, (err) => {});
      }
    } catch (err) {
      /* ignore errors when attempting to spawn pkill/taskkill */
    }
  }

  try {
    if (existsSync(QFLUSH_DAEMON_STATE_PATH)) {
      rmSync(QFLUSH_DAEMON_STATE_PATH, { force: true });
    }
  } catch (err) {
    logger.warn(`Failed to clear qflush daemon state: ${String(err)}`);
  }

  return killed;
}
