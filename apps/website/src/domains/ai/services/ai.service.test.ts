import { describe, expect, it, vi } from "vitest";

// @stayw/ai's conversations/repository.ts imports @stayw/database
// ("server-only") for real; Vitest externalizes that transitive workspace
// import so the global `server-only` mock in vitest.setup.mts doesn't reach
// it. Mock the whole package at the boundary, same pattern as
// domains/dashboard/services/dashboard.service.test.ts mocking @stayw/auth.
vi.mock("@stayw/ai", () => ({
  NotImplementedError: class NotImplementedError extends Error {},
  appendMessage: vi.fn(),
  approveAction: vi.fn(),
  createConversation: vi.fn(),
  escalateConversation: vi.fn(),
  executeApprovedTool: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  listPendingActions: vi.fn(),
  listRecentResolvedActions: vi.fn(),
  markActionExecuted: vi.fn(),
  markActionFailed: vi.fn(),
  registerPrompt: vi.fn(),
  rejectAction: vi.fn(),
  runOrchestratorTurn: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@/domains/audit/ai-tools", () => ({
  registerAuditAiTools: vi.fn(),
}));

vi.mock("@/domains/cleaning/ai-tools", () => ({
  registerCleaningAiTools: vi.fn(),
}));

vi.mock("@/domains/communications/ai-tools", () => ({
  registerCommunicationsAiTools: vi.fn(),
}));

vi.mock("@/domains/guests/ai-tools", () => ({
  registerGuestsAiTools: vi.fn(),
}));

vi.mock("@/domains/integrations/ai-tools", () => ({
  registerIntegrationsAiTools: vi.fn(),
}));

vi.mock("@/domains/maintenance/ai-tools", () => ({
  registerMaintenanceAiTools: vi.fn(),
}));

vi.mock("@/domains/notifications/ai-tools", () => ({
  registerNotificationsAiTools: vi.fn(),
}));

vi.mock("@/domains/properties/ai-tools", () => ({
  registerPropertiesAiTools: vi.fn(),
}));

vi.mock("@/domains/reservations/ai-tools", () => ({
  registerReservationsAiTools: vi.fn(),
}));

vi.mock("@/domains/tasks/ai-tools", () => ({
  registerTasksAiTools: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@/platform/notifications/create-notification", () => ({
  createNotificationsForGlobalRole: vi.fn(),
}));

import {
  NotImplementedError,
  appendMessage,
  approveAction,
  createConversation,
  escalateConversation,
  executeApprovedTool,
  getConversation,
  listConversations,
  listPendingActions,
  listRecentResolvedActions,
  markActionExecuted,
  markActionFailed,
  rejectAction,
  runOrchestratorTurn,
} from "@stayw/ai";
import { assertPermission } from "@stayw/auth";

import {
  approveAiAction,
  escalateAiConversation,
  getAiConversation,
  listAiConversations,
  listPendingAiActions,
  listRecentAiActions,
  rejectAiAction,
  sendAiMessage,
} from "./ai.service";

import { recordAudit } from "@/platform/audit/record-audit";
import { createNotificationsForGlobalRole } from "@/platform/notifications/create-notification";

const actor = { userId: "user-1" };

function orchestratorResult(overrides: Record<string, unknown> = {}) {
  return {
    assistantMessage: "Here's what's open today.",
    toolCalls: [],
    pendingApproval: false,
    escalationRecommended: false,
    stopReason: "end_turn",
    ...overrides,
  };
}

describe("listAiConversations", () => {
  it("returns conversations when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(listConversations).mockResolvedValueOnce([{ id: "c1" }] as never);

    const result = await listAiConversations(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "ai_conversations:read",
    );
    expect(result).toEqual([{ id: "c1" }]);
  });

  it("propagates denial when the actor lacks ai_conversations:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listAiConversations(actor)).rejects.toThrow();
    expect(listConversations).not.toHaveBeenCalled();
  });
});

describe("getAiConversation", () => {
  it("fetches one conversation when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(getConversation).mockResolvedValueOnce({ id: "c1" } as never);

    const result = await getAiConversation(actor, "c1");

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "ai_conversations:read",
    );
    expect(getConversation).toHaveBeenCalledWith("c1");
    expect(result).toEqual({ id: "c1" });
  });
});

describe("sendAiMessage", () => {
  it("creates a new OPS_ASSISTANT conversation, runs a turn with the registered tools, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(createConversation).mockResolvedValueOnce({ id: "c1" } as never);
    vi.mocked(runOrchestratorTurn).mockResolvedValueOnce(
      orchestratorResult() as never,
    );

    const result = await sendAiMessage(actor, {
      conversationId: "",
      message: "What's open today?",
    });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "ai_conversations:create",
    );
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "OPS_ASSISTANT",
        initiatedByUserId: actor.userId,
      }),
    );
    expect(runOrchestratorTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "c1",
        userMessage: "What's open today?",
        promptKey: "ops-assistant.system",
        toolNames: expect.arrayContaining(["properties.list"]),
        toolContext: { userId: actor.userId },
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "ai_conversation.message_sent",
        entityType: "AiConversation",
        entityId: "c1",
        metadata: { toolCalls: [] },
      }),
    );
    expect(result).toEqual({
      conversationId: "c1",
      assistantMessage: "Here's what's open today.",
      configured: true,
      pendingApproval: false,
      escalated: false,
      toolCalls: [],
    });
    expect(escalateConversation).not.toHaveBeenCalled();
    expect(createNotificationsForGlobalRole).not.toHaveBeenCalled();
  });

  it("reuses an existing conversationId instead of creating a new one", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(runOrchestratorTurn).mockResolvedValueOnce(
      orchestratorResult({ assistantMessage: "Sure." }) as never,
    );

    await sendAiMessage(actor, { conversationId: "c9", message: "hi" });

    expect(createConversation).not.toHaveBeenCalled();
    expect(runOrchestratorTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c9" }),
    );
  });

  it("notifies admins when a tool call is pending approval", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(runOrchestratorTurn).mockResolvedValueOnce(
      orchestratorResult({
        pendingApproval: true,
        toolCalls: [
          {
            name: "reservations.cancel",
            status: "pending_approval",
            actionId: "a1",
          },
        ],
      }) as never,
    );

    const result = await sendAiMessage(actor, {
      conversationId: "c1",
      message: "cancel it",
    });

    expect(createNotificationsForGlobalRole).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({ type: "AI_ACTION_PENDING" }),
    );
    expect(result.pendingApproval).toBe(true);
  });

  it("escalates the conversation and notifies admins when the turn recommends escalation", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(runOrchestratorTurn).mockResolvedValueOnce(
      orchestratorResult({ escalationRecommended: true }) as never,
    );

    const result = await sendAiMessage(actor, {
      conversationId: "c1",
      message: "help",
    });

    expect(escalateConversation).toHaveBeenCalledWith({
      conversationId: "c1",
      reason: "max_tool_iterations",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai_conversation.escalated" }),
    );
    expect(createNotificationsForGlobalRole).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({ type: "SYSTEM" }),
    );
    expect(result.escalated).toBe(true);
  });

  it("persists a SYSTEM notice and returns configured:false when Claude isn't set up yet", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(createConversation).mockResolvedValueOnce({ id: "c1" } as never);
    vi.mocked(runOrchestratorTurn).mockRejectedValueOnce(
      new NotImplementedError("ClaudeClient", "complete"),
    );

    const result = await sendAiMessage(actor, {
      conversationId: "",
      message: "hi",
    });

    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c1", role: "SYSTEM" }),
    );
    expect(result.configured).toBe(false);
    expect(result.assistantMessage).toMatch(/configured yet/i);
  });

  it("propagates a non-NotImplementedError instead of swallowing it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(createConversation).mockResolvedValueOnce({ id: "c1" } as never);
    vi.mocked(runOrchestratorTurn).mockRejectedValueOnce(new Error("db down"));

    await expect(
      sendAiMessage(actor, { conversationId: "", message: "hi" }),
    ).rejects.toThrow("db down");
  });

  it("denies sending and creates no conversation when the actor lacks ai_conversations:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      sendAiMessage(actor, { conversationId: "", message: "hi" }),
    ).rejects.toThrow();
    expect(createConversation).not.toHaveBeenCalled();
    expect(runOrchestratorTurn).not.toHaveBeenCalled();
  });
});

describe("escalateAiConversation", () => {
  it("escalates the conversation, audits it, and notifies admins", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(escalateConversation).mockResolvedValueOnce({
      id: "c1",
      status: "ESCALATED",
    } as never);

    const result = await escalateAiConversation(actor, "c1", {
      details: "Guest is upset",
    });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "ai_conversations:update",
    );
    expect(escalateConversation).toHaveBeenCalledWith({
      conversationId: "c1",
      reason: "user_requested",
      details: "Guest is upset",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai_conversation.escalated" }),
    );
    expect(createNotificationsForGlobalRole).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({ title: "AI conversation escalated" }),
    );
    expect(result).toEqual({ id: "c1", status: "ESCALATED" });
  });

  it("denies escalation and performs no writes when the actor lacks ai_conversations:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      escalateAiConversation(actor, "c1", { details: "" }),
    ).rejects.toThrow();
    expect(escalateConversation).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("listPendingAiActions", () => {
  it("returns pending actions when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(listPendingActions).mockResolvedValueOnce([
      { id: "a1" },
    ] as never);

    const result = await listPendingAiActions(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "ai_actions:read");
    expect(result).toEqual([{ id: "a1" }]);
  });
});

describe("listRecentAiActions", () => {
  it("returns recently resolved actions when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(listRecentResolvedActions).mockResolvedValueOnce([
      { id: "a1", status: "EXECUTED" },
    ] as never);

    const result = await listRecentAiActions(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "ai_actions:read");
    expect(result).toEqual([{ id: "a1", status: "EXECUTED" }]);
  });
});

describe("approveAiAction", () => {
  it("approves the action, executes the underlying tool, and audits both steps", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const approved = {
      id: "a1",
      status: "APPROVED",
      toolName: "tasks.complete",
      proposedInput: { taskId: "t1" },
      conversationId: "c1",
    };
    vi.mocked(approveAction).mockResolvedValueOnce(approved as never);
    vi.mocked(executeApprovedTool).mockResolvedValueOnce({
      id: "t1",
      status: "DONE",
    } as never);
    const executed = { ...approved, status: "EXECUTED" };
    vi.mocked(markActionExecuted).mockResolvedValueOnce(executed as never);

    const result = await approveAiAction(actor, "a1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "ai_actions:update");
    expect(approveAction).toHaveBeenCalledWith("a1", actor.userId);
    expect(executeApprovedTool).toHaveBeenCalledWith(
      "tasks.complete",
      { taskId: "t1" },
      { userId: actor.userId, conversationId: "c1" },
    );
    expect(markActionExecuted).toHaveBeenCalledWith("a1", {
      id: "t1",
      status: "DONE",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action.approved",
        entityType: "AiAction",
        entityId: "a1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action.executed",
        entityType: "AiAction",
        entityId: "a1",
      }),
    );
    // The response step of the full cycle: the conversation the action came
    // from gets a message reporting what happened, in the same
    // `{ calls: [...] }` shape the Orchestrator itself writes, so it renders
    // through the exact same tool-call UI as any other turn.
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "c1",
        role: "SYSTEM",
        content: "Approved action executed: tasks.complete.",
        toolCalls: {
          calls: [
            expect.objectContaining({
              name: "tasks.complete",
              status: "executed",
              output: { id: "t1", status: "DONE" },
            }),
          ],
        },
      }),
    );
    expect(result).toEqual(executed);
  });

  it("marks the action EXECUTION_FAILED, audits it, and reports the failure back into the conversation when the tool handler throws", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const approved = {
      id: "a1",
      status: "APPROVED",
      toolName: "guests.update",
      proposedInput: { guestId: "g1" },
      conversationId: "c1",
    };
    vi.mocked(approveAction).mockResolvedValueOnce(approved as never);
    vi.mocked(executeApprovedTool).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );
    const failed = { ...approved, status: "EXECUTION_FAILED" };
    vi.mocked(markActionFailed).mockResolvedValueOnce(failed as never);

    const result = await approveAiAction(actor, "a1");

    expect(markActionFailed).toHaveBeenCalledWith("a1", "ForbiddenError");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action.execution_failed",
        entityType: "AiAction",
        entityId: "a1",
      }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "c1",
        role: "SYSTEM",
        content: "Approved action failed: guests.update — ForbiddenError",
      }),
    );
    expect(result).toEqual(failed);
  });

  it("skips the conversation append when the action has no conversationId", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const approved = {
      id: "a1",
      status: "APPROVED",
      toolName: "guests.update",
      proposedInput: { guestId: "g1" },
      conversationId: null,
    };
    vi.mocked(approveAction).mockResolvedValueOnce(approved as never);
    vi.mocked(executeApprovedTool).mockResolvedValueOnce({} as never);
    vi.mocked(markActionExecuted).mockResolvedValueOnce({
      ...approved,
      status: "EXECUTED",
    } as never);

    await approveAiAction(actor, "a1");

    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("denies approval and performs no writes when the actor lacks ai_actions:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(approveAiAction(actor, "a1")).rejects.toThrow();
    expect(approveAction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("rejectAiAction", () => {
  it("rejects the action, audits it, and reports the rejection back into the conversation", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const rejected = {
      id: "a1",
      status: "REJECTED",
      toolName: "guests.update",
      conversationId: "c1",
    };
    vi.mocked(rejectAction).mockResolvedValueOnce(rejected as never);

    const result = await rejectAiAction(actor, "a1", {
      rejectionReason: "Not needed",
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "ai_actions:update");
    expect(rejectAction).toHaveBeenCalledWith("a1", actor.userId, "Not needed");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action.rejected",
        entityType: "AiAction",
        entityId: "a1",
      }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "c1",
        role: "SYSTEM",
        content: "Action rejected: guests.update — Not needed",
      }),
    );
    expect(result).toEqual(rejected);
  });

  it("skips the conversation append when the action has no conversationId", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(rejectAction).mockResolvedValueOnce({
      id: "a1",
      status: "REJECTED",
      conversationId: null,
    } as never);

    await rejectAiAction(actor, "a1", { rejectionReason: "x" });

    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("denies rejection and performs no writes when the actor lacks ai_actions:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      rejectAiAction(actor, "a1", { rejectionReason: "x" }),
    ).rejects.toThrow();
    expect(rejectAction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("full cycle: prompt -> tool selection -> approval -> execution -> response", () => {
  it("a message that proposes a write action ends with that action executed and its result back in the conversation", async () => {
    vi.mocked(assertPermission).mockResolvedValue(undefined);

    // 1. Prompt: sendAiMessage runs a turn where the model asks for a write
    // tool. The Orchestrator (mocked here at the package boundary — its own
    // real behavior is covered by packages/ai/src/orchestrator/
    // orchestrator.e2e.test.ts) pauses the turn and reports it pending.
    vi.mocked(runOrchestratorTurn).mockResolvedValueOnce(
      orchestratorResult({
        assistantMessage:
          "I've proposed marking this task complete — it needs approval.",
        pendingApproval: true,
        toolCalls: [
          {
            name: "tasks.complete",
            status: "pending_approval",
            actionId: "a1",
          },
        ],
      }) as never,
    );

    const sent = await sendAiMessage(actor, {
      conversationId: "c1",
      message: "Mark the checkout cleaning task done.",
    });

    expect(sent.pendingApproval).toBe(true);
    expect(sent.toolCalls).toEqual([
      expect.objectContaining({ name: "tasks.complete", actionId: "a1" }),
    ]);

    // 2. Approval + 3. Execution: a human approves action "a1", proposed
    // against conversation "c1" for tool "tasks.complete".
    vi.mocked(approveAction).mockResolvedValueOnce({
      id: "a1",
      status: "APPROVED",
      toolName: "tasks.complete",
      proposedInput: { taskId: "t1" },
      conversationId: "c1",
    } as never);
    vi.mocked(executeApprovedTool).mockResolvedValueOnce({
      id: "t1",
      status: "DONE",
    } as never);
    vi.mocked(markActionExecuted).mockResolvedValueOnce({
      id: "a1",
      status: "EXECUTED",
    } as never);

    const approved = await approveAiAction(actor, "a1");

    // 4. Response: the executed tool's own result is what actually ran
    // (the same task id the model proposed), and the outcome is appended
    // back to conversation "c1" — the same one the prompt started in — so
    // the full cycle is visible in one place, not scattered across the
    // pending-actions queue and an audit log nobody reads.
    expect(executeApprovedTool).toHaveBeenCalledWith(
      "tasks.complete",
      { taskId: "t1" },
      expect.objectContaining({ userId: actor.userId, conversationId: "c1" }),
    );
    expect(approved.status).toBe("EXECUTED");
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "c1",
        role: "SYSTEM",
        content: "Approved action executed: tasks.complete.",
      }),
    );
  });
});
