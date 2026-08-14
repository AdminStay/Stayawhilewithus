import { describe, expect, it, vi } from "vitest";

// @stayw/ai's registerTool/executeTool are exercised for real by that
// package's own test suite (packages/ai/src/tools/registry.test.ts),
// including the approval-gate branch. Faking the non-approval execution path
// here — schema.parse then call handler — keeps this test about *this*
// domain's wiring (does properties.list correctly wrap listProperties and
// enforce userId?) without pulling in @stayw/ai's server-only-guarded
// internals across a package boundary.
vi.mock("@stayw/ai", () => {
  const tools = new Map<
    string,
    {
      inputSchema: { parse: (i: unknown) => unknown };
      handler: (input: unknown, ctx: unknown) => Promise<unknown>;
    }
  >();
  return {
    registerTool: vi.fn((def) => tools.set(def.name, def)),
    executeTool: vi.fn(async (name: string, input: unknown, ctx: unknown) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`No tool registered named "${name}".`);
      const parsedInput = tool.inputSchema.parse(input);
      const output = await tool.handler(parsedInput, ctx);
      return { status: "executed", output };
    }),
  };
});

vi.mock("./services/properties.service", () => ({
  listProperties: vi.fn(),
  updatePropertyStatus: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerPropertiesAiTools } from "./ai-tools";
import {
  listProperties,
  updatePropertyStatus,
} from "./services/properties.service";

registerPropertiesAiTools();

describe("properties.list AI tool", () => {
  it("executes directly (no approval) and delegates to listProperties", async () => {
    vi.mocked(listProperties).mockResolvedValueOnce([{ id: "p1" }] as never);

    const result = await executeTool(
      "properties.list",
      {},
      { userId: "user-1" },
    );

    expect(listProperties).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "p1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("properties.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listProperties).not.toHaveBeenCalled();
  });
});

describe("properties.updateStatus AI tool", () => {
  it("delegates to updatePropertyStatus with the id split out of the input", async () => {
    vi.mocked(updatePropertyStatus).mockResolvedValueOnce({
      id: "p1",
      status: "INACTIVE",
    } as never);

    const result = await executeTool(
      "properties.updateStatus",
      { propertyId: "p1", status: "INACTIVE" },
      { userId: "user-1" },
    );

    expect(updatePropertyStatus).toHaveBeenCalledWith(
      { userId: "user-1" },
      "p1",
      { status: "INACTIVE" },
    );
    expect(result).toEqual({
      status: "executed",
      output: { id: "p1", status: "INACTIVE" },
    });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(
      executeTool(
        "properties.updateStatus",
        { propertyId: "p1", status: "INACTIVE" },
        {},
      ),
    ).rejects.toThrow(/requires an authenticated userId/);
    expect(updatePropertyStatus).not.toHaveBeenCalled();
  });
});
