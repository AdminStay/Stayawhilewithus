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

vi.mock("./services/audit.service", () => ({
  listAuditLogs: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerAuditAiTools } from "./ai-tools";
import { listAuditLogs } from "./services/audit.service";

registerAuditAiTools();

describe("audit.list AI tool", () => {
  it("executes directly (no approval) and delegates to listAuditLogs", async () => {
    vi.mocked(listAuditLogs).mockResolvedValueOnce([{ id: "al1" }] as never);

    const result = await executeTool("audit.list", {}, { userId: "user-1" });

    expect(listAuditLogs).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "al1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("audit.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listAuditLogs).not.toHaveBeenCalled();
  });
});
