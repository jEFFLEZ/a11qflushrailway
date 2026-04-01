// ROME-TAG: 0x1DEEBD

import alias from '../utils/alias.js';
const logger = alias.importUtil('@utils/logger') || alias.importUtil('../utils/logger') || console;

export function showHelp() {
  logger.info(`qflush - Funesterie orchestrator`);
  console.log(`
Usage:
  qflush [command] [options]

Commands:
  start        Launch selected services (default: detect → config → start)
  kill         Kill running services
  purge        Clear caches, logs and sessions
  inspect      Show running services and ports
  allmight     Audit duplicate families and propose canonicalization patches
  config       Generate missing .env/config files
  env          Manage env profiles (.qflush/env.profiles.json|yaml)
  secret import  Import secrets from a .env file into local encrypted store (Windows DPAPI)

Options (examples):
  --service rome --path D:/rome --token ABC123     Target a specific service and give path/token
  --service nezlephant --service freeland          Target multiple services
  --dev --fresh                                    Global flags (dev mode, fresh start)
  --force                                          Force restart semantics (implies kill before start)

Examples:
  qflush start --service rome --path D:/rome
  qflush start --service nezlephant --service freeland --fresh
  qflush config --service freeland
  qflush env init
  qflush env check dev
  qflush env generate railway --out .env.generated
  qflush allmight propose D:/SPYDER
  qflush purge --fresh

Scripts & helpers:
  node scripts/detach.js [--quiet] <command>   # spawn detached process (use --quiet to suppress output)
  ./scripts/run-with-timeout.sh <sec> <cmd>    # run command with timeout (POSIX)
  pwsh ./scripts/run-with-timeout.ps1 -Cmd "node dist/index.js start" -TimeoutSec 12  # PowerShell watchdog (quiet by default)
  qflush secret import [--env <path>] [--no-acl]   # import .env and store encrypted locally

`);
}
