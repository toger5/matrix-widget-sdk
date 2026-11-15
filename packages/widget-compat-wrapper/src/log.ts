/**
 * The wrapper's console logger. `warn` by default; the `log_level` query parameter changes it.
 *
 * Levels follow the Rust crates: `warn` for anything dropped or refused, `info` for the
 * lifecycle, `debug` for one line per message.
 */
export const LOG_LEVELS = ["off", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const PREFIX = "[widget-compat-wrapper]";
let current: LogLevel = "warn";

export function setLogLevel(level: LogLevel): void {
  current = level;
}

/** The level named by `value`, or `warn` (with a warning) when `value` is not a level. */
export function parseLogLevel(value: string | null): LogLevel {
  if (value === null) return "warn";
  if ((LOG_LEVELS as readonly string[]).includes(value)) return value as LogLevel;
  console.warn(PREFIX, `unknown log_level "${value}", using "warn"; expected one of ${LOG_LEVELS.join(", ")}`);
  return "warn";
}

const enabled = (level: LogLevel) => LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(current);

const at =
  (level: Exclude<LogLevel, "off">) =>
  (...args: unknown[]): void => {
    if (enabled(level)) console[level](PREFIX, ...args);
  };

export const log = { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug") };
