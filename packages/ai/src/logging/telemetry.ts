export interface TelemetryEvent {
  name: string;
  component: string;
  timestamp: string;
  durationMs?: number;
  [key: string]: unknown;
}

export type TelemetrySink = (event: TelemetryEvent) => void;

// Opt-in, unlike the logger — most environments don't want a metrics
// collector running by default, so this is a no-op until setTelemetrySink
// is called (e.g. once at app boot, wired to a real metrics backend).
let activeSink: TelemetrySink | null = null;

export function setTelemetrySink(sink: TelemetrySink): void {
  activeSink = sink;
}

export function resetTelemetrySink(): void {
  activeSink = null;
}

export interface Telemetry {
  count(name: string, fields?: Record<string, unknown>): void;
  duration(
    name: string,
    durationMs: number,
    fields?: Record<string, unknown>,
  ): void;
}

/** One telemetry emitter per component, mirroring createLogger's shape. */
export function createTelemetry(component: string): Telemetry {
  function emit(name: string, extra: Record<string, unknown> = {}): void {
    if (!activeSink) return;
    activeSink({
      name,
      component,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  }

  return {
    count: (name, fields) => emit(name, fields),
    duration: (name, durationMs, fields) =>
      emit(name, { durationMs, ...fields }),
  };
}

/** Times an async operation and emits a duration event under `name`, returning the operation's result untouched (including rethrowing on failure). */
export async function timed<T>(
  telemetry: Telemetry,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    telemetry.duration(name, Date.now() - start);
  }
}
