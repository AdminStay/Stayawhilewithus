export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  component: string;
  timestamp: string;
  [key: string]: unknown;
}

export type LogSink = (entry: LogEntry) => void;

// This repo's lint policy only allows console.warn/console.error (see
// eslint-config/base.js's no-console rule) — debug/info entries have no
// compliant console method, so the default sink drops them rather than
// bypassing that rule. This is also a reasonable production default on its
// own (most loggers default to warn-and-up); wire setLogSink to a real
// collector to see debug/info levels.
const consoleSink: LogSink = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
};

let activeSink: LogSink = consoleSink;

/**
 * Swaps where log entries go — e.g. wire this once at app boot to a real
 * log aggregator. Defaults to structured JSON on console, which is a
 * reasonable production default (most log collectors parse JSON lines) and
 * keeps this package dependency-free.
 */
export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}

export function resetLogSink(): void {
  activeSink = consoleSink;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** One logger per component (e.g. "orchestrator", "tools.registry") — every entry carries that tag plus a timestamp. */
export function createLogger(component: string): Logger {
  function write(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    activeSink({
      level,
      message,
      component,
      timestamp: new Date().toISOString(),
      ...fields,
    });
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
