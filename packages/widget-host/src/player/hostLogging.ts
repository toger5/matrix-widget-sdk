import { LogConfig, LogLevel, setLogSink, setupLogging } from "@matrix-widget-tools/widget-host-bindings";

const LOG_LEVELS = { error: LogLevel.Error, warn: LogLevel.Warn, info: LogLevel.Info, debug: LogLevel.Debug, trace: LogLevel.Trace };

type Listener = (kind: "err" | "sdk", text: string) => void;
const listeners = new Set<Listener>();

/** Receive the driver's log records (every open widget view shows them). Returns the unsubscribe function. */
export function onDriverLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Set the level of the host crates' log and hand its records to `onDriverLog` listeners. The
 * crates write every record to the browser console themselves (`writeToSystem`, on by default),
 * so the sink here must not. `level` is the `?log=` parameter (default `warn`), `filter` the
 * `?logFilter=` parameter (`RUST_LOG` syntax). Call once, after the bindings are initialised.
 */
export function setupDriverLogging(level: string | null, filter: string | null): void {
  const known = level !== null && level in LOG_LEVELS;
  setLogSink({
    log(record) {
      const kind = record.level <= LogLevel.Warn ? "err" : "sdk";
      const text = `${LogLevel[record.level].toLowerCase()} ${record.target}: ${record.message}`;
      listeners.forEach((listener) => listener(kind, text));
    },
  });
  setupLogging(LogConfig.create({ level: known ? LOG_LEVELS[level as keyof typeof LOG_LEVELS] : LogLevel.Warn, filter: filter ?? "" }));
  if (level !== null && !known) console.warn(`unknown ?log=${level}, using warn; expected one of ${Object.keys(LOG_LEVELS).join(", ")}`);
}
