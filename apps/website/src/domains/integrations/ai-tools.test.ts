import { describe, expect, it, vi } from "vitest";

// See properties/ai-tools.test.ts for why @stayw/ai is faked rather than
// imported for real here — this test is about this domain's wiring, not
// @stayw/ai's own registry/execution-engine behavior (covered by that
// package's own tests).
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

vi.mock("./services/integrations.service", () => ({
  listIntegrationConnections: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerIntegrationsAiTools } from "./ai-tools";
import { listIntegrationConnections } from "./services/integrations.service";

registerIntegrationsAiTools();

describe("integrations.list AI tool", () => {
  it("executes directly (no approval) and delegates to listIntegrationConnections", async () => {
    vi.mocked(listIntegrationConnections).mockResolvedValueOnce([
      { id: "ic1" },
    ] as never);

    const result = await executeTool(
      "integrations.list",
      {},
      { userId: "user-1" },
    );

    expect(listIntegrationConnections).toHaveBeenCalledWith({
      userId: "user-1",
    });
    expect(result).toEqual({ status: "executed", output: [{ id: "ic1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("integrations.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listIntegrationConnections).not.toHaveBeenCalled();
  });
});
