import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { getTool, listTools, registerTool } from "./registry";

describe("registerTool / getTool / listTools", () => {
  it("lists every registered tool", () => {
    registerTool({
      name: "test.listed",
      description: "d",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: async () => undefined,
    });

    expect(listTools().map((t) => t.name)).toContain("test.listed");
    expect(getTool("test.listed").name).toBe("test.listed");
  });

  it("re-registering the same name replaces the definition", () => {
    registerTool({
      name: "test.replaced",
      description: "first",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: vi.fn(),
    });
    registerTool({
      name: "test.replaced",
      description: "second",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: vi.fn(),
    });

    expect(getTool("test.replaced").description).toBe("second");
    expect(listTools().filter((t) => t.name === "test.replaced")).toHaveLength(
      1,
    );
  });

  it("throws for an unregistered tool name", () => {
    expect(() => getTool("test.nonexistent")).toThrow(
      /No tool registered named "test.nonexistent"/,
    );
  });
});
