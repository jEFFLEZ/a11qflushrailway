import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listEnvProfiles,
  loadEnvProfile,
  validateEnvProfile,
  writeSampleEnvProfilesConfig,
} from "../env/profiles.js";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qflush-env-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("env profiles", () => {
  it("lists profiles from local qflush config", () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, ".qflush"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".qflush", "env.profiles.json"),
      JSON.stringify({
        profiles: {
          dev: { vars: { A: "1" } },
          prod: { vars: { B: "2" } },
        },
      }),
      "utf8",
    );

    expect(listEnvProfiles(cwd)).toEqual(["dev", "prod"]);
  });

  it("merges extends, files and vars", () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, ".qflush"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".env.shared"), "SHARED=yes\nPORT=1234\n", "utf8");
    fs.writeFileSync(
      path.join(cwd, ".qflush", "env.profiles.json"),
      JSON.stringify({
        profiles: {
          base: {
            files: ["../.env.shared"],
            vars: { QFLUSH_LOG_FORMAT: "plain" },
          },
          dev: {
            extends: "base",
            vars: { PORT: "43421" },
            required: ["PORT", "SHARED"],
          },
        },
      }),
      "utf8",
    );

    const loaded = loadEnvProfile("dev", cwd);
    expect(loaded.values.SHARED).toBe("yes");
    expect(loaded.values.PORT).toBe("43421");
    expect(loaded.values.QFLUSH_LOG_FORMAT).toBe("plain");
  });

  it("detects missing required keys", () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, ".qflush"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".qflush", "env.profiles.json"),
      JSON.stringify({
        profiles: {
          dev: {
            vars: { PORT: "43421" },
            required: ["PORT", "QFLUSH_TOKEN"],
          },
        },
      }),
      "utf8",
    );

    const validation = validateEnvProfile("dev", cwd);
    expect(validation.ok).toBe(false);
    expect(validation.missing).toEqual(["QFLUSH_TOKEN"]);
  });

  it("writes a sample config on init", () => {
    const cwd = makeTempDir();
    const result = writeSampleEnvProfilesConfig(cwd);
    expect(result.created).toBe(true);
    expect(fs.existsSync(result.configPath)).toBe(true);
  });
});
