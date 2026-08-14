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

vi.mock("./services/communications.service", () => ({
  listMessageThreads: vi.fn(),
  sendMessage: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerCommunicationsAiTools } from "./ai-tools";
import {
  listMessageThreads,
  sendMessage,
} from "./services/communications.service";

registerCommunicationsAiTools();

describe("communications.list AI tool", () => {
  it("executes directly (no approval) and delegates to listMessageThreads", async () => {
    vi.mocked(listMessageThreads).mockResolvedValueOnce([
      { id: "th1" },
    ] as never);

    const result = await executeTool(
      "communications.list",
      {},
      { userId: "user-1" },
    );

    expect(listMessageThreads).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "th1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("communications.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listMessageThreads).not.toHaveBeenCalled();
  });
});

describe("communications.sendMessage AI tool", () => {
  it("delegates to sendMessage with the thread id split out of the input", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({
      id: "m1",
      body: "On our way.",
    } as never);

    const result = await executeTool(
      "communications.sendMessage",
      { threadId: "th1", body: "On our way." },
      { userId: "user-1" },
    );

    expect(sendMessage).toHaveBeenCalledWith({ userId: "user-1" }, "th1", {
      body: "On our way.",
    });
    expect(result).toEqual({
      status: "executed",
      output: { id: "m1", body: "On our way." },
    });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(
      executeTool(
        "communications.sendMessage",
        { threadId: "th1", body: "hi" },
        {},
      ),
    ).rejects.toThrow(/requires an authenticated userId/);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
