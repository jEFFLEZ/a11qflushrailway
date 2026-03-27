import fs from "fs";
import path from "path";
import logger from "../utils/logger.js";
import {
  listEnvProfiles,
  loadEnvProfile,
  renderEnvValues,
  validateEnvProfile,
  writeSampleEnvProfilesConfig,
} from "../env/profiles.js";

function readFlag(argv: string[], names: string[]) {
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (names.includes(current) && i < argv.length - 1) {
      return argv[i + 1];
    }
    const match = names.find((name) => current.startsWith(`${name}=`));
    if (match) {
      return current.slice(match.length + 1);
    }
  }
  return undefined;
}

function readPositionalProfile(argv: string[]) {
  for (const arg of argv) {
    if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

function printEnvHelp() {
  console.log(`
Usage:
  qflush env list
  qflush env show [profile] [--profile <name>]
  qflush env check [profile] [--profile <name>]
  qflush env generate [profile] [--out <path>]
  qflush env init

Config file:
  .qflush/env.profiles.json
  .qflush/env.profiles.yaml
  .qflush/env.profiles.yml
`);
}

export default async function runEnv(argv: string[] = []) {
  const subcommand = argv[0] || "list";
  const profile = readFlag(argv, ["--profile", "-p"]) || readPositionalProfile(argv.slice(1)) || "dev";
  const outFile = readFlag(argv, ["--out", "-o"]);

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printEnvHelp();
    return 0;
  }

  if (subcommand === "init") {
    const result = writeSampleEnvProfilesConfig();
    if (result.created) {
      logger.success(`Profils env init crees dans ${result.configPath}`);
    } else {
      logger.info(`Profils env deja presents dans ${result.configPath}`);
    }
    return 0;
  }

  if (subcommand === "list") {
    const profiles = listEnvProfiles();
    if (profiles.length === 0) {
      logger.warn("Aucun profil env configure. Lance `qflush env init` pour creer une base.");
      return 1;
    }
    for (const name of profiles) {
      console.log(name);
    }
    return 0;
  }

  if (subcommand === "show") {
    try {
      const loaded = loadEnvProfile(profile);
      logger.info(`Profil env ${profile}: ${Object.keys(loaded.values).length} variable(s)`);
      console.log(renderEnvValues(loaded.values));
      if (loaded.missingFiles.length > 0) {
        logger.warn(`Fichiers .env manquants ignores: ${loaded.missingFiles.join(", ")}`);
      }
      return 0;
    } catch (err) {
      logger.error(`${err instanceof Error ? err.message : String(err)}. Lance \`qflush env init\` si besoin.`);
      return 1;
    }
  }

  if (subcommand === "check") {
    try {
      const validation = validateEnvProfile(profile);
      const status = validation.ok ? "OK" : "INCOMPLET";
      logger.info(`Profil env ${profile}: ${status}`);
      logger.info(`variables=${Object.keys(validation.values).length} required=${validation.required.length}`);
      if (validation.missing.length > 0) {
        logger.warn(`Variables requises manquantes: ${validation.missing.join(", ")}`);
        return 2;
      }
      if (validation.missingFiles.length > 0) {
        logger.warn(`Fichiers .env manquants ignores: ${validation.missingFiles.join(", ")}`);
      }
      return 0;
    } catch (err) {
      logger.error(`${err instanceof Error ? err.message : String(err)}. Lance \`qflush env init\` si besoin.`);
      return 1;
    }
  }

  if (subcommand === "generate") {
    try {
      const loaded = loadEnvProfile(profile);
      const content = `${renderEnvValues(loaded.values)}\n`;
      if (!outFile) {
        process.stdout.write(content);
        return 0;
      }
      const absolute = path.isAbsolute(outFile) ? outFile : path.resolve(process.cwd(), outFile);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content, "utf8");
      logger.success(`Fichier env genere: ${absolute}`);
      if (loaded.missingFiles.length > 0) {
        logger.warn(`Fichiers .env manquants ignores: ${loaded.missingFiles.join(", ")}`);
      }
      return 0;
    } catch (err) {
      logger.error(`${err instanceof Error ? err.message : String(err)}. Lance \`qflush env init\` si besoin.`);
      return 1;
    }
  }

  printEnvHelp();
  return 1;
}
