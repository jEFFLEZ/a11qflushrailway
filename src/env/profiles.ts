import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { parse as parseDotenv } from "dotenv";

export type EnvProfileDefinition = {
  description?: string;
  extends?: string | string[];
  files?: string[];
  envFiles?: string[];
  vars?: Record<string, unknown>;
  required?: string[];
};

export type EnvProfilesFile = {
  profiles?: Record<string, EnvProfileDefinition>;
};

export type LoadedEnvProfilesFile = {
  configPath: string;
  configDir: string;
  config: EnvProfilesFile;
};

export type ResolvedEnvProfile = {
  name: string;
  description?: string;
  configPath: string;
  files: string[];
  vars: Record<string, string>;
  required: string[];
};

export type LoadedEnvProfile = ResolvedEnvProfile & {
  values: Record<string, string>;
  missingFiles: string[];
};

const CONFIG_CANDIDATES = [
  path.join(".qflush", "env.profiles.json"),
  path.join(".qflush", "env.profiles.yaml"),
  path.join(".qflush", "env.profiles.yml"),
];

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((entry) => String(entry)));
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeVars(raw: unknown): Record<string, string> {
  if (!isObject(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.trim()) continue;
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function parseProfilesConfig(raw: string, filePath: string): EnvProfilesFile {
  if (filePath.endsWith(".json")) {
    return JSON.parse(raw) as EnvProfilesFile;
  }
  return (yaml.load(raw) as EnvProfilesFile) || {};
}

export function findEnvProfilesFile(cwd = process.cwd()): LoadedEnvProfilesFile | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const absolute = path.join(cwd, candidate);
    if (!fs.existsSync(absolute)) continue;
    const raw = fs.readFileSync(absolute, "utf8");
    const config = parseProfilesConfig(raw, absolute);
    return {
      configPath: absolute,
      configDir: path.dirname(absolute),
      config,
    };
  }
  return null;
}

export function listEnvProfiles(cwd = process.cwd()): string[] {
  const loaded = findEnvProfilesFile(cwd);
  if (!loaded?.config?.profiles) return [];
  return Object.keys(loaded.config.profiles).sort((a, b) => a.localeCompare(b));
}

function resolveProfileRecursive(
  loaded: LoadedEnvProfilesFile,
  profileName: string,
  stack: string[] = [],
): ResolvedEnvProfile {
  const allProfiles = loaded.config.profiles || {};
  const profile = allProfiles[profileName];
  if (!profile) {
    throw new Error(`Profil env introuvable: ${profileName}`);
  }

  if (stack.includes(profileName)) {
    throw new Error(`Boucle detectee dans les profils env: ${[...stack, profileName].join(" -> ")}`);
  }

  const parents = toStringArray(profile.extends);
  const merged: ResolvedEnvProfile = {
    name: profileName,
    description: typeof profile.description === "string" ? profile.description.trim() : undefined,
    configPath: loaded.configPath,
    files: [],
    vars: {},
    required: [],
  };

  for (const parent of parents) {
    const resolvedParent = resolveProfileRecursive(loaded, parent, [...stack, profileName]);
    merged.files.push(...resolvedParent.files);
    merged.required.push(...resolvedParent.required);
    merged.vars = { ...merged.vars, ...resolvedParent.vars };
    if (!merged.description && resolvedParent.description) {
      merged.description = resolvedParent.description;
    }
  }

  merged.files.push(...toStringArray(profile.files), ...toStringArray(profile.envFiles));
  merged.required.push(...toStringArray(profile.required));
  merged.vars = { ...merged.vars, ...normalizeVars(profile.vars) };
  merged.files = uniqueStrings(merged.files);
  merged.required = uniqueStrings(merged.required);
  return merged;
}

export function resolveEnvProfile(profileName: string, cwd = process.cwd()): ResolvedEnvProfile {
  const loaded = findEnvProfilesFile(cwd);
  if (!loaded) {
    throw new Error("Aucun fichier de profils env trouve. Attendu: .qflush/env.profiles.json|yaml");
  }
  return resolveProfileRecursive(loaded, profileName);
}

function loadEnvFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseDotenv(content) as Record<string, string>;
}

export function loadEnvProfile(profileName: string, cwd = process.cwd()): LoadedEnvProfile {
  const resolved = resolveEnvProfile(profileName, cwd);
  const configDir = path.dirname(resolved.configPath);
  const values: Record<string, string> = {};
  const missingFiles: string[] = [];

  for (const file of resolved.files) {
    const absolute = path.isAbsolute(file) ? file : path.resolve(configDir, file);
    if (!fs.existsSync(absolute)) {
      missingFiles.push(absolute);
      continue;
    }
    Object.assign(values, loadEnvFile(absolute));
  }

  Object.assign(values, resolved.vars);
  return {
    ...resolved,
    values,
    missingFiles,
  };
}

export function validateEnvProfile(profileName: string, cwd = process.cwd()) {
  const loaded = loadEnvProfile(profileName, cwd);
  const missing = loaded.required.filter((key) => !(key in loaded.values));
  return {
    ...loaded,
    ok: missing.length === 0,
    missing,
  };
}

export function renderEnvValues(values: Record<string, string>) {
  return Object.keys(values)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${values[key]}`)
    .join("\n");
}

export function writeSampleEnvProfilesConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, ".qflush", "env.profiles.json");
  if (fs.existsSync(configPath)) {
    return { created: false, configPath };
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const sample = {
    profiles: {
      dev: {
        description: "Profil local A11/Qflush",
        files: [".env", ".env.local"],
        vars: {
          QFLUSHD_PORT: "43421",
          QFLUSH_LOG_FORMAT: "pretty",
        },
        required: ["QFLUSHD_PORT"],
      },
      railway: {
        extends: "dev",
        description: "Profil deploy Railway",
        vars: {
          QFLUSH_LOG_FORMAT: "json",
        },
      },
    },
  };

  fs.writeFileSync(configPath, `${JSON.stringify(sample, null, 2)}\n`, "utf8");
  return { created: true, configPath };
}
