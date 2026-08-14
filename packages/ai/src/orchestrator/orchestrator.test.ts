import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../context/registry", () => ({
  assembleContext: vi.fn(async () => [{ source: "test", content: "ctx" }]),
}));
vi.mock("../conversations/repository", () => ({
  appendMessage: vi.fn(async () => ({ id: "m1" })),
  getConversationHistory: vi.fn(async () => [
    { role: "USER", content: "Where's the wifi password?", tokenCount: 10 },
  ]),
}));
vi.mock("../prompts/registry", () => ({
  renderPrompt: vi.fn(() => "You are the StayWhile assistant. Context: ctx"),
}));
vi.mock("../tools/registry", () => ({
  getTool: vi.fn(),
}));
vi.mock("../tools/execution-engine", () => ({
  executeTool: vi.fn(),
}));

import {
  appendMessage,
  getConversationHistory,
} from "../conversations/repository";
import type { CompletionInput, CompletionResult } from "../provider/types";
import { executeTool } from "../tools/execution-engine";
import { getTool } from "../tools/registry";

import { runOrchestratorTurn } from "./orchestrator";

function textResult(text: string): CompletionResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn" };
}

describe("runOrchestratorTurn", () => {
  it("assembles context, renders the prompt, and persists both turns on a plain text reply", async () => {
    const modelProvider = {
      complete: vi.fn(async () =>
        textResult("The wifi password is on the fridge."),
      ),
      completeStream: vi.fn(),
    };

    const result = await runOrchestratorTurn(
      {
        conversationId: "c1",
        userMessage: "Where's the wifi password?",
        promptKey: "guest-support.system",
      },
      modelProvider,
    );

    expect(modelProvider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are the StayWhile assistant. Context: ctx",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        assistantMessage: "The wifi password is on the fridge.",
        toolCalls: [],
        pendingApproval: false,
        escalationRecommended: false,
        stopReason: "end_turn",
      }),
    );
  });

  it("throws NotImplementedError when no real provider is supplied", async () => {
    await expect(
      runOrchestratorTurn({
        conversationId: "c1",
        userMessage: "Where's the wifi password?",
        promptKey: "guest-support.system",
      }),
    ).rejects.toThrow(/not implemented yet/);
  });

  it("executes a requested tool via the Tool Execution Engine, feeds the result back, and returns the model's final answer", async () => {
    vi.mocked(getTool).mockReturnValueOnce({
      name: "properties.list",
      description: "Lists properties",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: vi.fn(),
    });
    vi.mocked(executeTool).mockResolvedValueOnce({
      status: "executed",
      output: [{ id: "p1", name: "Cabin A" }],
    });

    const modelProvider = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: [
            { type: "tool_use", id: "t1", name: "properties.list", input: {} },
          ],
          stopReason: "tool_use",
        } satisfies CompletionResult)
        .mockResolvedValueOnce(textResult("You have one property: Cabin A.")),
      completeStream: vi.fn(),
    };

    const result = await runOrchestratorTurn(
      {
        conversationId: "c1",
        userMessage: "What properties do we have?",
        promptKey: "ops-assistant.system",
        toolNames: ["properties.list"],
      },
      modelProvider,
    );

    expect(executeTool).toHaveBeenCalledWith(
      "properties.list",
      {},
      expect.objectContaining({ conversationId: "c1" }),
    );
    expect(modelProvider.complete).toHaveBeenCalledTimes(2);
    const secondCallArgs = modelProvider.complete.mock.calls[1]?.[0];
    expect(secondCallArgs.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: [
          expect.objectContaining({
            type: "tool_result",
            toolUseId: "t1",
          }),
        ],
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        assistantMessage: "You have one property: Cabin A.",
        toolCalls: [
          expect.objectContaining({
            name: "properties.list",
            status: "executed",
          }),
        ],
        pendingApproval: false,
        escalationRecommended: false,
      }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "ASSISTANT",
        content: "You have one property: Cabin A.",
        toolCalls: {
          calls: [
            expect.objectContaining({
              name: "properties.list",
              status: "executed",
            }),
          ],
        },
      }),
    );
  });

  it("doesn't attach a toolCalls record to a plain text-only reply", async () => {
    const modelProvider = {
      complete: vi.fn(async () => textResult("Just a plain answer.")),
      completeStream: vi.fn(),
    };

    await runOrchestratorTurn(
      {
        conversationId: "c1",
        userMessage: "hi",
        promptKey: "ops-assistant.system",
      },
      modelProvider,
    );

    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "ASSISTANT",
        content: "Just a plain answer.",
        toolCalls: undefined,
      }),
    );
  });

  it("stops the loop and reports pendingApproval when a tool requires human sign-off", async () => {
    vi.mocked(getTool).mockReturnValueOnce({
      name: "reservations.cancel",
      description: "Cancels a reservation",
      inputSchema: z.object({}),
      requiresApproval: true,
      handler: vi.fn(),
    });
    vi.mocked(executeTool).mockResolvedValueOnce({
      status: "pending_approval",
      actionId: "a1",
    });

    const modelProvider = {
      complete: vi.fn().mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "reservations.cancel",
            input: { reservationId: "r1" },
          },
        ],
        stopReason: "tool_use",
      } satisfies CompletionResult),
      completeStream: vi.fn(),
    };

    const result = await runOrchestratorTurn(
      {
        conversationId: "c1",
        userMessage: "Cancel reservation r1",
        promptKey: "ops-assistant.system",
        toolNames: ["reservations.cancel"],
      },
      modelProvider,
    );

    expect(modelProvider.complete).toHaveBeenCalledTimes(1);
    expect(result.pendingApproval).toBe(true);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: "reservations.cancel",
        status: "pending_approval",
        actionId: "a1",
      }),
    ]);
  });

  it("recommends escalation after exhausting maxToolIterations without a final answer", async () => {
    vi.mocked(getTool).mockReturnValue({
      name: "loop.tool",
      description: "Always asks for another tool call",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: vi.fn(),
    });
    vi.mocked(executeTool).mockResolvedValue({
      status: "executed",
      output: "ok",
    });

    const modelProvider = {
      complete: vi.fn().mockResolvedValue({
        content: [{ type: "tool_use", id: "t1", name: "loop.tool", input: {} }],
        stopReason: "tool_use",
      } satisfies CompletionResult),
      completeStream: vi.fn(),
    };

    const result = await runOrchestratorTurn(
      {
        conversationId: "c1",
        userMessage: "Do the thing",
        promptKey: "ops-assistant.system",
        toolNames: ["loop.tool"],
        maxToolIterations: 2,
      },
      modelProvider,
    );

    expect(modelProvider.complete).toHaveBeenCalledTimes(2);
    expect(result.escalationRecommended).toBe(true);
    expect(result.assistantMessage).toMatch(/human/i);
  });

  it("filters SYSTEM-role history out of what's replayed to the model", async () => {
    vi.mocked(getConversationHistory).mockResolvedValueOnce([
      { role: "USER", content: "hi", tokenCount: 2 },
      { role: "SYSTEM", content: "internal notice", tokenCount: 2 },
      { role: "ASSISTANT", content: "hello", tokenCount: 2 },
    ] as never);

    const modelProvider = {
      complete: vi.fn(async (_input: CompletionInput) =>
        textResult("hi again"),
      ),
      completeStream: vi.fn(),
    };

    await runOrchestratorTurn(
      {
        conversationId: "c1",
        userMessage: "still there?",
        promptKey: "ops-assistant.system",
      },
      modelProvider,
    );

    const callArgs = modelProvider.complete.mock.calls[0]?.[0];
    expect(
      callArgs?.messages.some((m) =>
        typeof m.content === "string"
          ? m.content.includes("internal notice")
          : false,
      ),
    ).toBe(false);
  });
});
