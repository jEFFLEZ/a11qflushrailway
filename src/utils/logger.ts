import { format } from "util";
import colors from "./colors.js";

export type QflushLogMode = "pretty" | "plain" | "json";

export type QflushLogOptions = {
  mode: QflushLogMode;
  useColors: boolean;
  includeTimestamps: boolean;
  enableDebug: boolean;
};

type AccentKind = "joker" | "base" | "neutral";
type LogLevel = "info" | "warn" | "error" | "success" | "debug";

function normalizeBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function resolveLogOptions(env: NodeJS.ProcessEnv = process.env): QflushLogOptions {
  const requested = String(env.QFLUSH_LOG_FORMAT || "").trim().toLowerCase();
  const mode: QflushLogMode =
    requested === "json" || requested === "plain" || requested === "pretty"
      ? (requested as QflushLogMode)
      : normalizeBoolean(env.QFLUSH_LOG_JSON, false)
        ? "json"
        : normalizeBoolean(env.CI, false)
          ? "plain"
          : "pretty";

  const useColors =
    mode === "pretty" &&
    !normalizeBoolean(env.QFLUSH_LOG_NO_COLOR, false) &&
    !("NO_COLOR" in env) &&
    Boolean(process.stdout && process.stdout.isTTY);

  const includeTimestamps =
    mode === "json" ? true : normalizeBoolean(env.QFLUSH_LOG_TIMESTAMPS, true);

  const enableDebug =
    normalizeBoolean(env.QFLUSH_DEBUG, false) ||
    (!normalizeBoolean(env.NODE_ENV === "production" ? "1" : "0", false) && env.NODE_ENV !== "production");

  return {
    mode,
    useColors,
    includeTimestamps,
    enableDebug,
  };
}

function getTimestamp() {
  return new Date().toISOString();
}

function getShortTimestamp() {
  return getTimestamp().slice(11, 23);
}

function formatMessage(message: string, rest: unknown[]) {
  return rest.length > 0 ? format(message, ...rest) : message;
}

function stringifyUnknown(value: unknown) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  return String(value);
}

function emitConsole(level: LogLevel, line: string) {
  switch (level) {
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
    case "debug":
      (console.debug || console.log)(line);
      return;
    default:
      console.log(line);
  }
}

function levelTag(level: LogLevel) {
  switch (level) {
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
    case "success":
      return "OK";
    case "debug":
      return "DEBUG";
    default:
      return "INFO";
  }
}

function colorizePrefix(level: LogLevel, text: string, useColors: boolean) {
  if (!useColors) return text;
  switch (level) {
    case "warn":
      return `\x1b[33m${text}\x1b[0m`;
    case "error":
      return `\x1b[31m${text}\x1b[0m`;
    case "success":
      return `\x1b[32m${text}\x1b[0m`;
    case "debug":
      return `\x1b[35m${text}\x1b[0m`;
    default:
      return `\x1b[36m${text}\x1b[0m`;
  }
}

export function formatLogLine(
  level: LogLevel,
  message: string,
  options: QflushLogOptions,
  meta: { scope?: string; accent?: AccentKind } = {},
) {
  if (options.mode === "json") {
    return JSON.stringify({
      timestamp: getTimestamp(),
      system: "qflush",
      level,
      scope: meta.scope || undefined,
      accent: meta.accent || undefined,
      message,
    });
  }

  const chunks: string[] = [];
  if (options.includeTimestamps) {
    chunks.push(`[${getShortTimestamp()}]`);
  }

  const basePrefix = `[QFLUSH][${levelTag(level)}]`;
  chunks.push(colorizePrefix(level, basePrefix, options.useColors));

  if (meta.scope) {
    chunks.push(`[${meta.scope}]`);
  }

  chunks.push(message);
  return chunks.join(" ");
}

function createBaseLogger(options: QflushLogOptions) {
  const emit = (level: LogLevel, message: string, ...rest: unknown[]) => {
    const line = formatLogLine(level, formatMessage(message, rest), options);
    emitConsole(level, line);
  };

  const emitAccent = (accent: AccentKind, fallbackLevel: LogLevel, title: string, message: string) => {
    if (options.mode === "pretty" && options.useColors && colors && typeof (colors as any).styledLog === "function") {
      (colors as any).styledLog(title, message, { accent });
      return;
    }
    const line = formatLogLine(fallbackLevel, message, options, { scope: title, accent });
    emitConsole(fallbackLevel, line);
  };

  return {
    info: (message: string, ...rest: unknown[]) => emit("info", message, ...rest),
    warn: (message: string, ...rest: unknown[]) => emit("warn", message, ...rest),
    error: (message: string, ...rest: unknown[]) => emit("error", message, ...rest),
    success: (message: string, ...rest: unknown[]) => emit("success", message, ...rest),
    debug: (...args: unknown[]) => {
      if (!options.enableDebug) return;
      const rendered = args
        .map((arg) => stringifyUnknown(arg))
        .join(" ");
      const line = formatLogLine("debug", rendered, options);
      emitConsole("debug", line);
    },
    joker: (title: string, message: string) => emitAccent("joker", "warn", title, message),
    nez: (title: string, message: string) => emitAccent("base", "info", title, message),
    neutral: (title: string, message: string) => emitAccent("neutral", "info", title, message),
  };
}

export function createLogger(env: NodeJS.ProcessEnv = process.env) {
  return createBaseLogger(resolveLogOptions(env));
}

const _logger = createLogger();

export const logger = _logger;
export default _logger;
export const info = _logger.info;
export const warn = _logger.warn;
export const error = _logger.error;
export const debug = _logger.debug;
export const success = _logger.success;
