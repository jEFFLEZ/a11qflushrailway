import path from "node:path";
import { applySafePatches, scanDuplicateFamilies, writeReportArtifacts } from "@funeste38/allmight";
import { logger } from "../utils/logger.js";

const VALID_COMMANDS = new Set(["scan", "report", "propose", "fix-safe", "canonicalize"]);

type ParsedArgs = {
  command: string;
  root: string;
  outputDir: string;
};

function usage() {
  logger.info([
    "usage: qflush allmight <scan|report|propose|fix-safe|canonicalize> [root] [--output <dir>]",
    "example: qflush allmight propose D:/SPYDER --output .qflush/allmight/spyder",
  ].join("\n"));
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let outputDir = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output") {
      outputDir = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputDir = arg.slice("--output=".length);
      continue;
    }
    positional.push(arg);
  }

  const command = positional[0] ?? "scan";
  const root = positional[1] ? path.resolve(positional[1]) : process.cwd();
  const label = path.basename(root) || "repo";
  return {
    command,
    root,
    outputDir: outputDir
      ? path.resolve(outputDir)
      : path.resolve(process.cwd(), ".qflush", "allmight", label),
  };
}

async function writeArtifactsFor(root: string, outputDir: string) {
  const report = await scanDuplicateFamilies(root, { outputDir });
  await writeReportArtifacts(report, outputDir);
  return report;
}

export default async function runAllmight(argv: string[] = []) {
  const { command, root, outputDir } = parseArgs(argv);

  if (!VALID_COMMANDS.has(command)) {
    usage();
    return 1;
  }

  logger.info(`allmight: scanning ${root}`);
  let report = await writeArtifactsFor(root, outputDir);

  if (command === "fix-safe") {
    const applied = await applySafePatches(report);
    report = await writeArtifactsFor(root, outputDir);
    logger.success(`allmight: applied ${applied.length} safe patches`);
  }

  if (command === "canonicalize") {
    console.log(JSON.stringify(report.canonicalMap, null, 2));
  } else {
    logger.info(`allmight: families=${report.stats.familiesDetected} patches=${report.stats.patchesProposed} safe=${report.stats.safePatches}`);
    logger.info(`allmight: artifacts -> ${outputDir}`);
  }

  return 0;
}
