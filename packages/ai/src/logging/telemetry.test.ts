import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTelemetry,
  resetTelemetrySink,
  setTelemetrySink,
  timed,
} from "./telemetry";

afterEach(() => {
  resetTelemetrySink();
});

describe("createTelemetry", () => {
  it("is a no-op until a sink is set", () => {
    const telemetry = createTelemetry("orchestrator");

    expect(() => telemetry.count("turn.started")).not.toThrow();
  });

  it("emits count events tagged with the component name", () => {
    const events: unknown[] = [];
    setTelemetrySink((event) => events.push(event));
    const telemetry = createTelemetry("orchestrator");

    telemetry.count("turn.started", { conversationId: "c1" });

    expect(events).toEqual([
      expect.objectContaining({
        name: "turn.started",
        component: "orchestrator",
        conversationId: "c1",
        timestamp: expect.any(String),
      }),
    ]);
  });

  it("emits duration events with durationMs merged into the payload", () => {
    const events: unknown[] = [];
    setTelemetrySink((event) => events.push(event));
    const telemetry = createTelemetry("orchestrator");

    telemetry.duration("turn.completed", 42, { conversationId: "c1" });

    expect(events).toEqual([
      expect.objectContaining({
        name: "turn.completed",
        durationMs: 42,
        conversationId: "c1",
      }),
    ]);
  });
});

describe("timed", () => {
  it("returns the wrapped function's result and emits a duration event", async () => {
    const events: unknown[] = [];
    setTelemetrySink((event) => events.push(event));
    const telemetry = createTelemetry("orchestrator");

    const result = await timed(telemetry, "turn.completed", async () => "ok");

    expect(result).toBe("ok");
    expect(events).toEqual([
      expect.objectContaining({
        name: "turn.completed",
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("still emits a duration event and rethrows when the operation fails", async () => {
    const events: unknown[] = [];
    setTelemetrySink((event) => events.push(event));
    const telemetry = createTelemetry("orchestrator");
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(timed(telemetry, "turn.completed", fn)).rejects.toThrow(
      "boom",
    );
    expect(events).toHaveLength(1);
  });
});
