import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Unlike orchestrator.test.ts (which mocks tools/registry, tools/execution-
// engine, and conversations/repository to isolate the Orchestrator's own
// coordination logic), this file mocks nothing above the database — the
// real Planner, real Tool Registry, real Tool Execution Engine, and real
// Action Approval Framework all run together. This is the one test in the
// package that proves the whole prompt -> tool selection -> approval ->
// execution -> persisted-history chain actually works end to end, not just
// that each module behaves correctly in isolation.
vi.mock("@stayw/database", () => ({
  prisma: {
    aiMessage: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: `msg-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date(),
        ...args.data,
      })),
      findMany: vi.fn(async () => []),
    },
    aiAction: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "action-1",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      })),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "action-1",
        ...args.data,
      })),
    },
  },
  Prisma: {},
}));

import { prisma } from "@stayw/database";

import { approveAction, markActionExecuted } from "../actions/approval";
import { registerPrompt } from "../prompts/registry";
import type { CompletionResult, ModelProvider } from "../provider/types";
import { executeApprovedTool } from "../tools/execution-engine";
import { registerTool } from "../tools/registry";

import { runOrchestratorTurn } from "./orchestrator";

registerPrompt({
  key: "e2e.system",
  version: 1,
  template: "You are a test assistant.",
});

describe("end-to-end: prompt -> tool selection -> approval -> execution -> persisted history", () => {
  const sendGuestMessage = vi.fn(async (input: { body: string }) => ({
    sent: true,
    body: input.body,
  }));

  beforeEach(() => {
    sendGuestMessage.mockClear();
    registerTool({
      name: "e2e.sendGuestMessage",
      description: "Sends a message to a guest",
      inputSchema: z.object({ body: z.string() }),
      requiresApproval: true,
      handler: sendGuestMessage,
    });
  });

  it("runs the full loop: the model asks for a tool, the turn pauses for approval, and the persisted history records the pending call", async () => {
    const modelProvider: ModelProvider = {
      complete: vi.fn(
        async () =>
          ({
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "e2e.sendGuestMessage",
                input: { body: "Welcome to StayWhile!" },
              },
            ],
            stopReason: "tool_use",
          }) satisfies CompletionResult,
      ),
      completeStream: vi.fn(),
    };

    const result = await runOrchestratorTurn(
      {
        conversationId: "conv-1",
        userMessage: "Send the new guest a welcome message.",
        promptKey: "e2e.system",
        toolNames: ["e2e.sendGuestMessage"],
        toolContext: { userId: "user-1" },
      },
      modelProvider,
    );

    // Tool selection: the real Planner read the model's tool_use block and
    // the real Tool Execution Engine ran it — which, because the tool
    // requires approval, proposed a real AiAction instead of calling the
    // handler.
    expect(sendGuestMessage).not.toHaveBeenCalled();
    expect(prisma.aiAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolName: "e2e.sendGuestMessage",
          proposedInput: { body: "Welcome to StayWhile!" },
          status: "PENDING",
        }),
      }),
    );
    expect(result.pendingApproval).toBe(true);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: "e2e.sendGuestMessage",
        status: "pending_approval",
        actionId: "action-1",
      }),
    ]);

    // Persisted history: the paused turn's ASSISTANT message carries the
    // tool call record, not just a status flag on the in-memory result.
    expect(prisma.aiMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "ASSISTANT",
          toolCalls: {
            calls: [
              expect.objectContaining({
                name: "e2e.sendGuestMessage",
                status: "pending_approval",
                actionId: "action-1",
              }),
            ],
          },
        }),
      }),
    );

    // Approval: a human approves the same action id the turn produced.
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValueOnce({
      id: "action-1",
      status: "PENDING",
      toolName: "e2e.sendGuestMessage",
      proposedInput: { body: "Welcome to StayWhile!" },
      conversationId: "conv-1",
    } as never);

    const approved = await approveAction("action-1", "approver-1");
    expect(approved.status).toBe("APPROVED");

    // Execution: the approved action's tool actually runs now, through the
    // Tool Execution Engine's dedicated post-approval path — the same
    // registry lookup and schema validation as any other tool call, just
    // without re-proposing another approval.
    const output = await executeApprovedTool(
      "e2e.sendGuestMessage",
      { body: "Welcome to StayWhile!" },
      { userId: "approver-1", conversationId: "conv-1" },
    );
    expect(sendGuestMessage).toHaveBeenCalledWith(
      { body: "Welcome to StayWhile!" },
      { userId: "approver-1", conversationId: "conv-1" },
    );
    expect(output).toEqual({ sent: true, body: "Welcome to StayWhile!" });

    // Final state transition: APPROVED -> EXECUTED, with the real handler's
    // output recorded as the action's executionResult.
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValueOnce({
      id: "action-1",
      status: "APPROVED",
    } as never);
    const executed = await markActionExecuted(
      "action-1",
      output as Record<string, unknown>,
    );
    expect(executed).toEqual(
      expect.objectContaining({
        status: "EXECUTED",
        executionResult: output,
      }),
    );
  });

  it("runs the full loop for a tool that doesn't require approval: selected, executed, and its result persisted in one turn", async () => {
    const listSomething = vi.fn(async () => [{ id: "p1" }]);
    registerTool({
      name: "e2e.listSomething",
      description: "Lists things",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: listSomething,
    });

    const modelProvider: ModelProvider = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "e2e.listSomething",
              input: {},
            },
          ],
          stopReason: "tool_use",
        } satisfies CompletionResult)
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "You have one thing: p1." }],
          stopReason: "end_turn",
        } satisfies CompletionResult),
      completeStream: vi.fn(),
    };

    const result = await runOrchestratorTurn(
      {
        conversationId: "conv-2",
        userMessage: "What do we have?",
        promptKey: "e2e.system",
        toolNames: ["e2e.listSomething"],
        toolContext: { userId: "user-1" },
      },
      modelProvider,
    );

    expect(listSomething).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(result.assistantMessage).toBe("You have one thing: p1.");
    expect(result.pendingApproval).toBe(false);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: "e2e.listSomething",
        status: "executed",
        output: [{ id: "p1" }],
      }),
    ]);
    expect(prisma.aiMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "ASSISTANT",
          content: "You have one thing: p1.",
          toolCalls: {
            calls: [
              expect.objectContaining({
                name: "e2e.listSomething",
                status: "executed",
              }),
            ],
          },
        }),
      }),
    );
  });
});
