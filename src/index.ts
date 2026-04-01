import { createRequire } from 'module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);

// ROME-TAG: 0x2A0018

// Register global error handlers early to avoid the CLI crashing on unhandled errors (redis, etc.)
process.on('unhandledRejection', (reason) => {
  try {
    console.warn('Unhandled Rejection:', reason && (reason as any).stack ? (reason as any).stack : String(reason));
  } catch (err) {
    console.warn('Failed to log unhandledRejection:', err);
  }
});
process.on('uncaughtException', (err) => {
  try {
    console.error('Uncaught Exception:', err && (err as any).stack ? (err as any).stack : String(err));
  } catch (e) {
    console.warn('Failed to log uncaughtException:', e);
  }
});

// Early exit for version/about flags to avoid importing modules with side-effects.
const _argv = process.argv.slice(2);
if (_argv.includes('--version') || _argv.includes('-v')) {
  try {
    const pkg = require('../package.json');
    if (pkg && pkg.version) console.log(pkg.version);
    else console.log('unknown');
  } catch (e) { console.log('unknown'); }
  process.exit(0);
}
if (_argv.includes('--about') || _argv.includes('-a')) {
  try {
    const pkg = require('../package.json');
    console.log(`${pkg.name} - ${pkg.description}\nversion ${pkg.version}`);
  } catch (e) { console.log('qflush - Funesterie orchestrator'); }
  process.exit(0);
}
if (_argv.includes('--upgrade')) {
  // simple upgrade helper: attempt to npm install -g the same package name
  console.log('Attempting upgrade...');
  const { spawnSync } = require('child_process');
  const res = spawnSync('npm', ['install', '-g', '@funeste38/qflush@latest'], { stdio: 'inherit' });
  process.exit(res.status ?? 0);
}

import { buildPipeline, executePipeline } from "./chain/smartChain.js";
import { showHelp } from "./cli/help.js";
import { runCompose } from "./commands/compose.js";
import { runDoctor } from "./commands/doctor.js";
import runNpzInspect from "./commands/npz-inspect.js";
import runNpzScores from "./commands/npz-scores.js";
import { runInspect } from "./commands/inspect.js";
import { runLicense } from "./commands/license.js";
import runEnv from "./commands/env.js";
import runChecksum from "./commands/checksum.js";
import runEngine from "./commands/engine.js";
import runLogic from "./commands/logic.js";
import runCopilot from "./commands/copilot.js";
import runCopilotBridge from "./commands/copilot-bridge.js";
import runRomeLinks from "./commands/rome-links.js";
import runA11 from "./commands/a11.js";
import runSpyder from "./commands/spyder.js";
import runAllmight from "./commands/allmight.js";
import { spawn } from 'child_process';
import { enterSleepMode, exitSleepMode, jokerWipe } from './services.js';
import { startQflushSystem } from './core/start-system.js';
import { runPiccolo } from "./commands/piccolo.js";
import './services/index.js';

const isEntrypoint = (() => {
  try {
    const entry = process.argv[1];
    return !!entry && import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

// Only run the CLI dispatch when this module is the entrypoint
if (isEntrypoint) {
  const argv = process.argv.slice(2);
  let cliHandled = false;
  if (argv.includes("--help") || argv.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  const first = argv[0];
  // CLI aliases for embedded BAT modes
  if (first === 'bat:sleep') {
    try {
      enterSleepMode();
      console.log('BAT: sleep mode engaged');
      process.exit(0);
    } catch (e) {
      console.error('failed to enter sleep mode', e);
      process.exit(1);
    }
  }
  if (first === 'bat:wake') {
    try {
      exitSleepMode();
      console.log('BAT: exited sleep mode');
      process.exit(0);
    } catch (e) {
      console.error('failed to exit sleep mode', e);
      process.exit(1);
    }
  }
  if (first === 'bat:joker') {
    try {
      // call and return; jokerWipe may exit process
      jokerWipe();
      // give it a moment
      setTimeout(() => process.exit(0), 1000);
    } catch (e) {
      console.error('failed to perform joker wipe', e);
      process.exit(1);
    }
  }

  if (first === "compose") {
    void runCompose(argv.slice(1));
    process.exit(0);
  }
  if (first === "inspect") {
    (async () => {
      try {
        await runInspect();
        process.exit(0);
      } catch (err) {
        console.error("inspect failed", err);
        process.exit(1);
      }
    })();
    cliHandled = true;
  }
  if (first === 'apply') {
    (async () => {
      try {
        const m: any = await import('./commands/apply.js');
        if (m && typeof m.default === 'function') {
          const code = await m.default(argv.slice(1));
          process.exit(code ?? 0);
        } else {
          console.error('apply command not available');
          process.exit(2);
        }
      } catch (e) {
        console.error('failed to run apply', e);
        process.exit(1);
      }
    })();
    cliHandled = true;
  }
  if (first === "doctor") {
    void runDoctor(argv.slice(1));
    process.exit(0);
  }
  if (first === "env") {
    (async () => {
      try {
        const code = await runEnv(argv.slice(1));
        process.exit(code ?? 0);
      } catch (err) {
        console.error("env command failed", err);
        process.exit(1);
      }
    })();
    cliHandled = true;
  }
  if (first === "daemon") {
    // Default to detached mode to avoid launching heavy in-process work (opens files, scanners).
    // Pass `--no-detach` to run in-process explicitly.
    const detached = argv.includes('--detached') || !argv.includes('--no-detach');
    if (!argv.includes('--detached') && !argv.includes('--no-detach')) {
      console.log('qflush: starting daemon in detached mode by default (use --no-detach to run in-process)');
    }

    const useCortex = argv.includes('--use-cortex') || process.env.QFLUSH_USE_CORTEX === '1';
    // If the user explicitly requested --use-cortex we still allow startQflushSystem to manage both.
    if (detached) {
      try {
        // attempt to use @funeste38/bat to spawn detached
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bat = require('@funeste38/bat');
        if (bat && typeof bat.spawn === 'function') {
          bat.spawn('qflushd', process.execPath, ['dist/daemon/qflushd.js']);
          console.log('qflushd spawned detached via bat');
          process.exit(0);
        }
      } catch (e) {
        console.warn('detached spawn via bat unavailable, using fallback:', e);
      }
      // fallback to detached child process
      try {
        const child = spawn(process.execPath, ['dist/daemon/qflushd.js'], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            QFLUSHD_PORT: process.env.QFLUSHD_PORT || '43421'
          }
        });
        child.unref();
        console.log('qflushd spawned detached (fallback)');
        process.exit(0);
      } catch (err) {
        console.error('failed to spawn detached daemon', err);
        process.exit(1);
      }
    }

    // start systems in-process using hybrid starter (CORTEX and/or daemon depending on QFLUSH_MODE)
    try {
      // This will start Cortex bus and/or daemon server per QFLUSH_MODE
      startQflushSystem();
    } catch (err) {
      console.error('failed to start qflush system', err);
      process.exit(1);
    }
    // keep process alive by marking handled (avoid running CLI pipeline)
    cliHandled = true;
  }

  if (first === 'a11' || first === 'a11:status') {
    (async () => {
      const code = await runA11(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'spyder' || first === 'spyder:status' || first === 'spyder:mem') {
    (async () => {
      const code = await runSpyder(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'allmight') {
    (async () => {
      const code = await runAllmight(argv.slice(1));
      process.exit(code ?? 0);
    })();
    cliHandled = true;
  }

  if (first === 'engine' ) {
    (async () => {
      const code = await runEngine(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'logic' ) {
    (async () => {
      const code = await runLogic(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'copilot' ) {
    (async () => {
      const code = await runCopilot(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'copilot-bridge' ) {
    (async () => {
      const code = await runCopilotBridge(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'license' || (first === 'lic' && argv[1] === 'activate')) {
    (async () => {
      const code = await runLicense(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'checksum' && argv[1]) {
    (async () => {
      const code = await runChecksum(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  if (first === 'rome:links' || (first === 'rome' && argv[1] === 'links')) {
    (async () => {
      const code = await runRomeLinks(argv.slice(1));
      process.exit(code ?? 0);
    })();
  }

  // NPZ inspect command: `qflush npz:inspect <id>` or `qflush npz inspect <id>`
  if (first === "npz:inspect" || (first === "npz" && argv[1] === "inspect")) {
    const id = first === "npz:inspect" ? argv[1] : argv[2];
    if (!id) {
      console.error("usage: qflush npz:inspect <npz_id>");
      process.exit(1);
    }
    // run and exit with returned code
    (async () => {
      try {
        const code = await runNpzInspect(id);
        process.exit(code ?? 0);
      } catch (err) {
        console.error("npz inspect failed", err);
        process.exit(1);
      }
    })();
  }

  if (first === "npz:scores" || (first === "npz" && argv[1] === "scores")) {
    (async () => {
      try {
        const args = first === "npz:scores" ? argv.slice(1) : argv.slice(2);
        const code = await runNpzScores(args);
        process.exit(code ?? 0);
      } catch (err) {
        console.error("npz scores failed", err);
        process.exit(1);
      }
    })();
  }

  if (first === "npz:scores:reset" || (first === "npz" && argv[1] === "scores:reset")) {
    (async () => {
      try {
        const code = await runNpzScores(["--reset"]);
        process.exit(code ?? 0);
      } catch (err) {
        console.error("npz scores reset failed", err);
        process.exit(1);
      }
    })();
  }

  if (first === 'cortex') {
    (async () => {
      const cmd = argv[1];
      if (!cmd) {
        console.error('usage: qflush cortex <command> [args]');
        process.exit(1);
      }
      try {
        const m = await import('./cortex/cli.js');
        const id = m.cortexSend(cmd, argv.slice(2));
        try {
          const res = await m.cortexWaitFor(id, 10000);
          console.log(JSON.stringify(res, null, 2));
          process.exit(0);
        } catch (e) {
          console.error('cortex wait error', e);
          process.exit(1);
        }
      } catch (err) {
        console.error('failed to run cortex command', err);
        process.exit(1);
      }
    })();
    cliHandled = true;
  }

  // Add 'resonnance' command routing
  if (first === 'resonnance') {
    (async () => {
      try {
        const m: any = await import('./commands/resonnance.js');
        if (!m || typeof m.default !== 'function') throw new Error('resonnance command not available');
        await m.default();
        process.exit(0);
      } catch (err) {
        console.error('failed to start resonnance', err);
        process.exit(1);
      }
    })();
    cliHandled = true;
  }

  if (first === 'piccolo') {
    void runPiccolo(argv.slice(1));
    process.exit(0);
  }

  if (!cliHandled) {
    const { pipeline, options } = buildPipeline(argv);

    executePipeline(pipeline, options).catch((err) => {
      console.error("qflush: fatal", err);
      process.exit(1);
    });
  }
}
