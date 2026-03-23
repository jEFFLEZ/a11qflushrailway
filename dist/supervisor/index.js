// ROME-TAG: 0xACAF19
import { spawn } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import alias from '../utils/alias.js';
// Prefer aliased util when available, fallback to local logger or console.
let _aliasedLogger = undefined;
try {
    _aliasedLogger = alias.importUtil('@utils/logger') || alias.importUtil('../utils/logger');
}
catch (e) {
    _aliasedLogger = undefined;
}
let logger;
try {
    if (_aliasedLogger && typeof _aliasedLogger.info === 'function')
        logger = _aliasedLogger;
    else {
        // direct local import fallback ensures we have the expected API
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const local = require('../utils/logger');
        logger = (local && local.default) || local || console;
    }
}
catch (e) {
    logger = console;
}
// Use canonical state dir '.qflush'
const STATE_DIR = join(process.cwd(), '.qflush');
const LOGS_DIR = join(STATE_DIR, 'logs');
const STATE_FILE = join(STATE_DIR, 'services.json');
let procs = {};
const managed = new Map();
function ensureStateDir() {
    if (!existsSync(STATE_DIR))
        mkdirSync(STATE_DIR, { recursive: true });
    if (!existsSync(LOGS_DIR))
        mkdirSync(LOGS_DIR, { recursive: true });
}
function persist() {
    try {
        ensureStateDir();
        writeFileSync(STATE_FILE, JSON.stringify(procs, null, 2), 'utf8');
    }
    catch (err) {
        logger.warn(`Failed to persist supervisor state: ${err}`);
    }
}
function load() {
    try {
        if (existsSync(STATE_FILE)) {
            const raw = readFileSync(STATE_FILE, 'utf8');
            procs = JSON.parse(raw);
        }
    }
    catch (err) {
        logger.warn(`Failed to load supervisor state: ${err}`);
    }
}
load();
export function listRunning() {
    return Object.values(procs);
}
function safeCloseStream(s) {
    if (!s)
        return;
    try {
        try {
            s.end(() => { });
        }
        catch (err) {
            try {
                s.destroy && s.destroy();
            }
            catch (err2) {
                logger.warn('[supervisor] safeCloseStream destroy failed:', err2);
            }
        }
    }
    catch (err) {
        logger.warn('[supervisor] safeCloseStream failed:', err);
    }
}
function isAlive(mp) {
    if (!mp || !mp.child || !mp.child.pid)
        return false;
    try {
        process.kill(mp.child.pid, 0);
        return true;
    }
    catch (err) {
        logger.warn('[supervisor] isAlive check failed:', err);
        return false;
    }
}
let freezeMode = 'none';
export function getFreezeMode() {
    return freezeMode;
}
export function resumeAll() {
    if (freezeMode === 'none') {
        logger.info('[supervisor] resumeAll: already normal');
        return;
    }
    freezeMode = 'none';
    logger.info('[supervisor] resumeAll: supervisor back to normal mode (spawns allowed)');
}
// Simple health watcher (HTTP GET 2xx => healthy)
function startHealthWatch(url, onHealthy, intervalMs = 3000) {
    let stopped = false;
    const tick = async () => {
        if (stopped)
            return;
        try {
            const u = new URL(url);
            const mod = u.protocol === 'https:' ? require('https') : require('http');
            const req = mod.request(url, { method: 'GET', timeout: 4000 }, (res) => {
                const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
                // consume body
                res.on('data', () => { });
                res.on('end', () => {
                    if (ok) {
                        try {
                            onHealthy();
                        }
                        catch (e) {
                            logger.warn(`[supervisor] healthWatch onHealthy failed: ${e}`);
                        }
                        stopped = true;
                        return;
                    }
                    if (!stopped)
                        setTimeout(tick, intervalMs);
                });
            });
            req.on('error', () => { if (!stopped)
                setTimeout(tick, intervalMs); });
            req.on('timeout', () => { try {
                req.abort();
            }
            catch (err) {
                logger.warn('[supervisor] healthWatch req.abort failed:', err);
            } if (!stopped)
                setTimeout(tick, intervalMs); });
            req.end();
        }
        catch (e) {
            if (!stopped)
                setTimeout(tick, intervalMs);
        }
    };
    tick();
    return () => { stopped = true; };
}
// Non-blocking safe kill: fire-and-forget watchdog to ensure no blocking on kill
function safeKillAsync(child, timeoutMs = 3000) {
    if (!child || !child.pid)
        return;
    const IS_WINDOWS = process.platform === 'win32';
    let finished = false;
    const done = (label) => {
        if (finished)
            return;
        finished = true;
        logger.info(`[supervisor] safeKill: ${label} (pid=${child && child.pid})`);
    };
    const onExit = () => done('process exited');
    try {
        child.once && child.once('exit', onExit);
    }
    catch (err) {
        logger.warn('[supervisor] safeKill child.once failed:', err);
    }
    // soft kill
    try {
        if (IS_WINDOWS)
            child.kill();
        else
            child.kill('SIGTERM');
    }
    catch (e) {
        logger.warn(`[supervisor] safeKill soft kill failed: ${String(e)}`);
    }
    // watchdog
    setTimeout(() => {
        if (finished)
            return;
        logger.warn('[supervisor] safeKill: timeout, trying hard kill');
        if (IS_WINDOWS) {
            try {
                const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
                tk.on('exit', () => done('hard-killed via taskkill'));
                tk.on('error', (err) => { logger.warn('[supervisor] taskkill failed: ' + String(err)); done('gave up after taskkill error'); });
            }
            catch (e) {
                logger.warn('[supervisor] taskkill spawn failed: ' + String(e));
                done('gave up after taskkill spawn error');
            }
        }
        else {
            try {
                process.kill(child.pid, 'SIGKILL');
                done('hard-killed via SIGKILL');
            }
            catch (e) {
                logger.warn('[supervisor] SIGKILL failed: ' + String(e));
                done('gave up after SIGKILL error');
            }
        }
    }, timeoutMs);
}
export function startProcess(name, cmd, args = [], opts = {}) {
    if (freezeMode === 'frozen') {
        logger.warn(`[supervisor] startProcess: ${name} skipped because supervisor is frozen`);
        return null;
    }
    ensureStateDir();
    logger.info(`supervisor: starting ${name} -> ${cmd} ${args.join(' ')}`);
    const logFile = opts.logPath || join(LOGS_DIR, `${name}.log`);
    let outStream = null;
    try {
        const parent = dirname(logFile);
        if (!existsSync(parent))
            mkdirSync(parent, { recursive: true });
        outStream = createWriteStream(logFile, { flags: 'a' });
        outStream.on('error', (err) => logger.warn(`[supervisor] log stream error for ${name}: ${err}`));
    }
    catch (err) {
        logger.warn(`[supervisor] failed to open log file ${logFile} for ${name}: ${err}`);
        outStream = null;
    }
    const spawnOpts = { cwd: opts.cwd || process.cwd(), shell: true };
    spawnOpts.stdio = ['ignore', 'pipe', 'pipe'];
    if (opts.detached)
        spawnOpts.detached = true;
    const existing = managed.get(name);
    if (isAlive(existing)) {
        logger.info(`supervisor: ${name} is already running (pid=${existing.child.pid}), skipping start`);
        return existing.child;
    }
    managed.set(name, { name, child: null, info: { name, pid: null, cmd, args, cwd: opts.cwd, log: logFile, detached: !!spawnOpts.detached }, outStream });
    // If cmd looks like a JS/CJS/MJS file path, run it with the current node executable
    let execCmd = cmd;
    let execArgs = args;
    try {
        const lower = String(cmd || '').toLowerCase();
        if (lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) {
            // prefer running explicit node to avoid permission/executable issues
            // put the script path as first arg
            execCmd = process.execPath;
            execArgs = [cmd].concat(args || []);
            // avoid using a shell when running node directly
            spawnOpts.shell = false;
        }
    }
    catch (e) {
        // fallback to original cmd
        execCmd = cmd;
        execArgs = args;
    }
    const child = spawn(execCmd, execArgs, spawnOpts);
    if (child.stdout && outStream)
        child.stdout.pipe(outStream);
    if (child.stderr && outStream)
        child.stderr.pipe(outStream);
    child.on('error', (err) => logger.error(`supervisor: ${name} process error ${err.message}`));
    child.on('exit', (code) => {
        logger.warn(`supervisor: ${name} exited with ${code}`);
        const m = managed.get(name);
        if (m) {
            m.child = null;
            safeCloseStream(m.outStream);
            m.outStream = null;
        }
        if (procs[name])
            delete procs[name];
        persist();
    });
    if (spawnOpts.detached) {
        try {
            child.unref();
        }
        catch (err) {
            logger.warn('[supervisor] child.unref failed:', err);
        }
    }
    const record = { name, pid: child.pid || null, cmd, args, cwd: opts.cwd, log: logFile, detached: !!spawnOpts.detached };
    procs[name] = record;
    managed.set(name, { name, child, info: record, outStream });
    persist();
    return child;
}
export function stopProcess(name) {
    const entry = procs[name];
    const m = managed.get(name);
    if (!entry && !m)
        return false;
    try {
        if (m && m.child) {
            // non-blocking safe kill
            safeKillAsync(m.child, 3000);
            m.child = null;
        }
        else if (entry && entry.pid) {
            // best-effort taskkill for pid without managed child
            try {
                spawn('taskkill', ['/PID', String(entry.pid), '/T', '/F'], { windowsHide: true });
            }
            catch (err) {
                logger.warn('[supervisor] taskkill spawn failed:', err);
            }
        }
        safeCloseStream(m?.outStream ?? null);
        if (procs[name])
            delete procs[name];
        if (managed.has(name))
            managed.delete(name);
        persist();
        return true;
    }
    catch (err) {
        logger.warn(`supervisor: failed to kill ${name} pid=${entry?.pid} (${err})`);
        return false;
    }
}
export function stopAll() {
    const names = Array.from(managed.keys());
    for (const n of names) {
        stopProcess(n);
    }
    try {
        if (existsSync(STATE_FILE))
            unlinkSync(STATE_FILE);
    }
    catch (err) {
        logger.warn('[supervisor] stopAll failed to remove state file:', err);
    }
}
export function clearState() {
    procs = {};
    for (const [, m] of managed)
        safeCloseStream(m.outStream);
    managed.clear();
    try {
        if (existsSync(STATE_FILE))
            unlinkSync(STATE_FILE);
    }
    catch (err) {
        logger.warn('[supervisor] clearState failed to remove state file:', err);
    }
}
export function freezeAll(reason, opts) {
    if (freezeMode === 'frozen') {
        logger.info('[supervisor] freezeAll: already frozen');
        return;
    }
    freezeMode = 'frozen';
    logger.warn(`supervisor: entering frozen mode${reason ? ` - ${reason}` : ''}`);
    // close streams and persist minimal state
    for (const [, m] of managed) {
        safeCloseStream(m.outStream);
        m.outStream = null;
        if (m.child && m.child.pid && procs[m.name])
            procs[m.name].pid = m.child.pid;
    }
    persist();
    if (opts && opts.autoResume && opts.resumeCheck && opts.resumeCheck.url) {
        const intervalMs = opts.resumeCheck.intervalMs || 3000;
        const timeoutMs = opts.resumeCheck.timeoutMs || 5 * 60 * 1000;
        const stopWatch = startHealthWatch(opts.resumeCheck.url, () => {
            logger.info('[supervisor] healthWatch detected healthy -> resuming');
            resumeAll();
            stopWatch();
        }, intervalMs);
        // optional overall timeout to stop watcher
        setTimeout(() => { try {
            stopWatch();
        }
        catch (err) {
            logger.warn('[supervisor] stopWatch failed:', err);
        } }, timeoutMs);
    }
}
export default {
    startProcess,
    stopProcess,
    stopAll,
    clearState,
    listRunning,
    freezeAll,
    resumeAll,
    getFreezeMode,
};
