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

vi.mock("./services/cleaning.service", () => ({
  listCleaningSchedules: vi.fn(),
  completeCleaningSchedule: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerCleaningAiTools } from "./ai-tools";
import {
  completeCleaningSchedule,
  listCleaningSchedules,
} from "./services/cleaning.service";

registerCleaningAiTools();

describe("cleaning.list AI tool", () => {
  it("executes directly (no approval) and delegates to listCleaningSchedules", async () => {
    vi.mocked(listCleaningSchedules).mockResolvedValueOnce([
      { id: "c1" },
    ] as never);

    const result = await executeTool("cleaning.list", {}, { userId: "user-1" });

    expect(listCleaningSchedules).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "c1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("cleaning.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listCleaningSchedules).not.toHaveBeenCalled();
  });
});

describe("cleaning.complete AI tool", () => {
  it("delegates to completeCleaningSchedule with the given scheduleId", async () => {
    vi.mocked(completeCleaningSchedule).mockResolvedValueOnce({
      id: "c1",
      status: "COMPLETED",
    } as never);

    const result = await executeTool(
      "cleaning.complete",
      { scheduleId: "c1" },
      { userId: "user-1" },
    );

    expect(completeCleaningSchedule).toHaveBeenCalledWith(
      { userId: "user-1" },
      "c1",
    );
    expect(result).toEqual({
      status: "executed",
      output: { id: "c1", status: "COMPLETED" },
    });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(
      executeTool("cleaning.complete", { scheduleId: "c1" }, {}),
    ).rejects.toThrow(/requires an authenticated userId/);
    expect(completeCleaningSchedule).not.toHaveBeenCalled();
  });
});
