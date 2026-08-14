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

vi.mock("./services/maintenance.service", () => ({
  listMaintenanceRequests: vi.fn(),
  resolveMaintenanceRequest: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerMaintenanceAiTools } from "./ai-tools";
import {
  listMaintenanceRequests,
  resolveMaintenanceRequest,
} from "./services/maintenance.service";

registerMaintenanceAiTools();

describe("maintenance.list AI tool", () => {
  it("executes directly (no approval) and delegates to listMaintenanceRequests", async () => {
    vi.mocked(listMaintenanceRequests).mockResolvedValueOnce([
      { id: "mr1" },
    ] as never);

    const result = await executeTool(
      "maintenance.list",
      {},
      { userId: "user-1" },
    );

    expect(listMaintenanceRequests).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "mr1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("maintenance.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listMaintenanceRequests).not.toHaveBeenCalled();
  });
});

describe("maintenance.resolve AI tool", () => {
  it("delegates to resolveMaintenanceRequest with the id split out of the input", async () => {
    vi.mocked(resolveMaintenanceRequest).mockResolvedValueOnce({
      id: "mr1",
      status: "RESOLVED",
    } as never);

    const result = await executeTool(
      "maintenance.resolve",
      { requestId: "mr1", resolutionNotes: "Fixed the leak." },
      { userId: "user-1" },
    );

    expect(resolveMaintenanceRequest).toHaveBeenCalledWith(
      { userId: "user-1" },
      "mr1",
      { resolutionNotes: "Fixed the leak." },
    );
    expect(result).toEqual({
      status: "executed",
      output: { id: "mr1", status: "RESOLVED" },
    });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(
      executeTool("maintenance.resolve", { requestId: "mr1" }, {}),
    ).rejects.toThrow(/requires an authenticated userId/);
    expect(resolveMaintenanceRequest).not.toHaveBeenCalled();
  });
});
