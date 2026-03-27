import { describe, expect, it } from "vitest";
import { formatLogLine, resolveLogOptions } from "../utils/logger.js";

describe("qflush logger", () => {
  it("resolves plain mode in CI by default", () => {
    const options = resolveLogOptions({ CI: "1" } as NodeJS.ProcessEnv);
    expect(options.mode).toBe("plain");
    expect(options.useColors).toBe(false);
  });

  it("supports explicit json mode", () => {
    const options = resolveLogOptions({ QFLUSH_LOG_FORMAT: "json" } as NodeJS.ProcessEnv);
    const line = formatLogLine("info", "hello", options, { scope: "daemon" });
    const parsed = JSON.parse(line);
    expect(parsed.system).toBe("qflush");
    expect(parsed.level).toBe("info");
    expect(parsed.scope).toBe("daemon");
    expect(parsed.message).toBe("hello");
  });

  it("formats plain logs with qflush prefix and scope", () => {
    const options = resolveLogOptions({
      QFLUSH_LOG_FORMAT: "plain",
      QFLUSH_LOG_TIMESTAMPS: "0",
    } as NodeJS.ProcessEnv);
    const line = formatLogLine("warn", "daemon unreachable", options, { scope: "health" });
    expect(line).toContain("[QFLUSH][WARN]");
    expect(line).toContain("[health]");
    expect(line).toContain("daemon unreachable");
  });
});
