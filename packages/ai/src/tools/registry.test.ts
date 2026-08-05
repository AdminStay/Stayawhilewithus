import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../actions/approval", () => ({
  proposeAction: vi.fn(),
}));

import { proposeAction } from "../actions/approval";

import { executeTool, getTool, listTools, registerTool } from "./registry";

describe("executeTool", () => {
  it("runs the handler directly when requiresApproval is false", async () => {
    registerTool({
      name: "test.echo",
      description: "Echoes input",
      inputSchema: z.object({ text: z.string() }),
      requiresApproval: false,
      handler: async (input) => ({ echoed: input.text }),
    });

    const result = await executeTool("test.echo", { text: "hi" }, {});

    expect(result).toEqual({ status: "executed", output: { echoed: "hi" } });
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("proposes an action instead of executing when requiresApproval is true", async () => {
    vi.mocked(proposeAction).mockResolvedValue({ id: "action-1" } as never);
    const handler = vi.fn();
    registerTool({
      name: "test.send-message",
      description: "Sends a guest message",
      inputSchema: z.object({ body: z.string() }),
      requiresApproval: true,
      riskLevel: "HIGH",
      handler,
    });

    const result = await executeTool(
      "test.send-message",
      { body: "Welcome!" },
      { conversationId: "conv-1" },
    );

    expect(result).toEqual({
      status: "pending_approval",
      actionId: "action-1",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        toolName: "test.send-message",
        proposedInput: { body: "Welcome!" },
        riskLevel: "HIGH",
      }),
    );
  });

  it("rejects input that fails schema validation before ever proposing or executing", async () => {
    registerTool({
      name: "test.strict",
      description: "Requires a number",
      inputSchema: z.object({ count: z.number() }),
      requiresApproval: false,
      handler: vi.fn(),
    });

    await expect(
      executeTool("test.strict", { count: "not a number" }, {}),
    ).rejects.toThrow();
  });

  it("throws for an unregistered tool name", async () => {
    await expect(executeTool("test.nonexistent", {}, {})).rejects.toThrow(
      /No tool registered named "test.nonexistent"/,
    );
  });
});

describe("getTool / listTools", () => {
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
});
