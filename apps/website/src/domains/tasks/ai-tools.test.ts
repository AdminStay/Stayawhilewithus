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

vi.mock("./services/tasks.service", () => ({
  listTasks: vi.fn(),
  completeTask: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerTasksAiTools } from "./ai-tools";
import { completeTask, listTasks } from "./services/tasks.service";

registerTasksAiTools();

describe("tasks.list AI tool", () => {
  it("executes directly (no approval) and delegates to listTasks", async () => {
    vi.mocked(listTasks).mockResolvedValueOnce([{ id: "t1" }] as never);

    const result = await executeTool("tasks.list", {}, { userId: "user-1" });

    expect(listTasks).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "t1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("tasks.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listTasks).not.toHaveBeenCalled();
  });
});

describe("tasks.complete AI tool", () => {
  it("delegates to completeTask with the given taskId", async () => {
    vi.mocked(completeTask).mockResolvedValueOnce({
      id: "t1",
      status: "DONE",
    } as never);

    const result = await executeTool(
      "tasks.complete",
      { taskId: "t1" },
      { userId: "user-1" },
    );

    expect(completeTask).toHaveBeenCalledWith({ userId: "user-1" }, "t1");
    expect(result).toEqual({
      status: "executed",
      output: { id: "t1", status: "DONE" },
    });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(
      executeTool("tasks.complete", { taskId: "t1" }, {}),
    ).rejects.toThrow(/requires an authenticated userId/);
    expect(completeTask).not.toHaveBeenCalled();
  });
});
