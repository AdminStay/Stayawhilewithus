import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, resetLogSink, setLogSink } from "./logger";

afterEach(() => {
  resetLogSink();
});

describe("createLogger", () => {
  it("tags every entry with the component name and a level-appropriate message", () => {
    const entries: unknown[] = [];
    setLogSink((entry) => entries.push(entry));
    const logger = createLogger("orchestrator");

    logger.info("turn started", { conversationId: "c1" });
    logger.error("tool failed", { toolName: "properties.list" });

    expect(entries).toEqual([
      expect.objectContaining({
        level: "info",
        message: "turn started",
        component: "orchestrator",
        conversationId: "c1",
        timestamp: expect.any(String),
      }),
      expect.objectContaining({
        level: "error",
        message: "tool failed",
        component: "orchestrator",
        toolName: "properties.list",
        timestamp: expect.any(String),
      }),
    ]);
  });

  it("supports debug and warn levels too", () => {
    const entries: unknown[] = [];
    setLogSink((entry) => entries.push(entry));
    const logger = createLogger("test");

    logger.debug("debug message");
    logger.warn("warn message");

    expect(entries).toEqual([
      expect.objectContaining({ level: "debug", message: "debug message" }),
      expect.objectContaining({ level: "warn", message: "warn message" }),
    ]);
  });

  it("defaults to a console sink that writes structured JSON", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger("test");

    logger.error("boom");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(logged).toEqual(
      expect.objectContaining({ level: "error", message: "boom" }),
    );
    errorSpy.mockRestore();
  });

  it("drops debug/info from the default console sink — only warn/error are console-compliant in this repo", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger("test");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
