import "server-only";

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
  registerPrompt,
  rejectAction,
  runOrchestratorTurn,
} from "@stayw/ai";
import { assertPermission, type AuthContext } from "@stayw/auth";
import type { AiAction, AiConversation, Prisma } from "@stayw/database";

import type {
  EscalateAiConversationInput,
  RejectAiActionInput,
  SendAiMessageInput,
} from "../schemas/ai.schema";

import { registerAuditAiTools } from "@/domains/audit/ai-tools";
import { registerCleaningAiTools } from "@/domains/cleaning/ai-tools";
import { registerCommunicationsAiTools } from "@/domains/communications/ai-tools";
import { registerGuestsAiTools } from "@/domains/guests/ai-tools";
import { registerIntegrationsAiTools } from "@/domains/integrations/ai-tools";
import { registerMaintenanceAiTools } from "@/domains/maintenance/ai-tools";
import { registerNotificationsAiTools } from "@/domains/notifications/ai-tools";
import { registerPropertiesAiTools } from "@/domains/properties/ai-tools";
import { registerReservationsAiTools } from "@/domains/reservations/ai-tools";
import { registerTasksAiTools } from "@/domains/tasks/ai-tools";
import { recordAudit } from "@/platform/audit/record-audit";
import { createNotificationsForGlobalRole } from "@/platform/notifications/create-notification";

export type { AiAction, AiConversation };

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

/**
 * Every tool the ops-assistant conversation may call this turn — one
 * read-only `<domain>.list` per domain, plus the handful of real,
 * approval-gated write operations each domain currently exposes. Extend as
 * more domains register AI tools; each domain owns its own tool names (see
 * `domains/<domain>/ai-tools.ts`), this is just the roster passed into the
 * orchestrator loop.
 */
const CONVERSATION_TOOL_NAMES = [
  "properties.list",
  "properties.updateStatus",
  "guests.list",
  "guests.update",
  "reservations.list",
  "reservations.updateStatus",
  "tasks.list",
  "tasks.complete",
  "cleaning.list",
  "cleaning.complete",
  "communications.list",
  "communications.sendMessage",
  "maintenance.list",
  "maintenance.resolve",
  "integrations.list",
  "audit.list",
  "notifications.list",
];

/**
 * Registered once, at module load — idempotent (Map.set on both the prompt
 * registry and the tool registry), so re-importing this module (e.g. across
 * Server Action invocations) is harmless. No app-startup hook exists yet to
 * do this centrally — registering as a module-level side effect here is the
 * pragmatic fix until one does. This is also what finally makes
 * registerPropertiesAiTools() get called for real — previously defined but
 * never invoked from anywhere.
 */
registerPrompt({
  key: "ops-assistant.system",
  version: 1,
  template:
    "You are the StayWhile Ops Assistant, helping StayWhile staff manage " +
    "short-term rental operations (properties, reservations, tasks, " +
    "cleaning, maintenance, guest communications). Be concise and " +
    "operational. Use the context below when relevant.\n\nContext:\n{{context}}",
});
registerPropertiesAiTools();
registerGuestsAiTools();
registerReservationsAiTools();
registerTasksAiTools();
registerCleaningAiTools();
registerCommunicationsAiTools();
registerMaintenanceAiTools();
registerIntegrationsAiTools();
registerAuditAiTools();
registerNotificationsAiTools();

export async function listAiConversations(actor: AuthContext) {
  await assertPermission(actor, "ai_conversations:read");
  return listConversations();
}

export async function getAiConversation(
  actor: AuthContext,
  conversationId: string,
) {
  await assertPermission(actor, "ai_conversations:read");
  return getConversation(conversationId);
}

/**
 * Starts a new OPS_ASSISTANT conversation if no conversationId is given,
 * then runs one real agentic orchestrator turn (context assembly, the tool-
 * use loop, memory windowing, retries — see @stayw/ai's Orchestrator). If
 * Claude isn't configured yet (NotImplementedClaudeClient — no
 * ANTHROPIC_API_KEY), the user's message is still persisted; a SYSTEM-role
 * notice explaining why there's no real reply is persisted too, so it shows
 * up in the thread the same way any other message would — no client-side
 * state needed, matching every other Server Action in this codebase. This
 * is the credential boundary the rest of the feature is built fully around.
 *
 * A tool call that requires approval pauses the turn (pendingApproval) —
 * ops staff review it via the pending-actions queue on this same page, and
 * admins get notified. Hitting the tool-use iteration cap
 * (escalationRecommended) escalates the conversation automatically and
 * notifies admins the same way.
 */
export async function sendAiMessage(
  actor: AuthContext,
  input: SendAiMessageInput,
) {
  await assertPermission(actor, "ai_conversations:create");

  let conversationId = input.conversationId || undefined;
  if (!conversationId) {
    const conversation = await createConversation({
      context: "OPS_ASSISTANT",
      model: DEFAULT_MODEL,
      initiatedByUserId: actor.userId,
    });
    conversationId = conversation.id;
  }

  try {
    const result = await runOrchestratorTurn({
      conversationId,
      userMessage: input.message,
      promptKey: "ops-assistant.system",
      toolNames: CONVERSATION_TOOL_NAMES,
      toolContext: { userId: actor.userId },
    });

    await recordAudit({
      actorUserId: actor.userId,
      actorType: "USER",
      action: "ai_conversation.message_sent",
      entityType: "AiConversation",
      entityId: conversationId,
      metadata: {
        toolCalls: result.toolCalls,
      } as unknown as Prisma.InputJsonValue,
    });

    if (result.toolCalls.some((call) => call.status === "pending_approval")) {
      await createNotificationsForGlobalRole("admin", {
        type: "AI_ACTION_PENDING",
        title: "AI action awaiting approval",
        body: `An AI conversation proposed an action that needs review.`,
        channel: "IN_APP",
        relatedEntityType: "AiConversation",
        relatedEntityId: conversationId,
      });
    }

    if (result.escalationRecommended) {
      await escalateConversation({
        conversationId,
        reason: "max_tool_iterations",
      });
      await recordAudit({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "ai_conversation.escalated",
        entityType: "AiConversation",
        entityId: conversationId,
        metadata: { reason: "max_tool_iterations" },
      });
      await createNotificationsForGlobalRole("admin", {
        type: "SYSTEM",
        title: "AI conversation needs a human",
        body: "The ops assistant couldn't complete a request within its allotted steps and has been escalated.",
        channel: "IN_APP",
        relatedEntityType: "AiConversation",
        relatedEntityId: conversationId,
      });
    }

    return {
      conversationId,
      assistantMessage: result.assistantMessage,
      configured: true,
      pendingApproval: result.pendingApproval,
      escalated: result.escalationRecommended,
      toolCalls: result.toolCalls,
    };
  } catch (err) {
    if (err instanceof NotImplementedError) {
      const notice =
        "The AI assistant isn't configured yet — an administrator needs to set ANTHROPIC_API_KEY.";
      await appendMessage({
        conversationId,
        role: "SYSTEM",
        content: notice,
      });
      return {
        conversationId,
        assistantMessage: notice,
        configured: false,
        pendingApproval: false,
        escalated: false,
        toolCalls: [],
      };
    }
    throw err;
  }
}

/** Explicit, user-triggered handoff — e.g. a "talk to a human" button, distinct from the automatic max-iteration escalation in sendAiMessage. */
export async function escalateAiConversation(
  actor: AuthContext,
  conversationId: string,
  input: EscalateAiConversationInput,
) {
  await assertPermission(actor, "ai_conversations:update");

  const conversation = await escalateConversation({
    conversationId,
    reason: "user_requested",
    details: input.details,
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "ai_conversation.escalated",
    entityType: "AiConversation",
    entityId: conversationId,
    metadata: { reason: "user_requested", details: input.details },
  });

  await createNotificationsForGlobalRole("admin", {
    type: "SYSTEM",
    title: "AI conversation escalated",
    body: input.details || "A user escalated an AI conversation to a human.",
    channel: "IN_APP",
    relatedEntityType: "AiConversation",
    relatedEntityId: conversationId,
  });

  return conversation;
}

export async function listPendingAiActions(actor: AuthContext) {
  await assertPermission(actor, "ai_actions:read");
  return listPendingActions();
}

/** Approved/rejected actions and their outcome — a resolved action drops out of listPendingAiActions with nothing else confirming what happened to it, so the approval UX needs this to show real completion, not just disappearance. */
export async function listRecentAiActions(actor: AuthContext) {
  await assertPermission(actor, "ai_actions:read");
  return listRecentResolvedActions();
}

/**
 * Approving moves the action PENDING -> APPROVED, then immediately runs the
 * tool through `executeApprovedTool` (the Tool Execution Engine's dedicated
 * post-approval path — same registry lookup + schema validation the
 * Orchestrator's own tool calls go through, just without re-proposing
 * another approval) and transitions it again, APPROVED -> EXECUTED or
 * EXECUTION_FAILED. The handler enforces its own permissions the same way
 * it would if the model had called it directly (each domain's ai-tools.ts
 * handler passes `{ userId: actor.userId }` into the underlying service,
 * which runs its own assertPermission) — approving an action you don't
 * otherwise have permission to perform still fails, safely, as
 * EXECUTION_FAILED with the ForbiddenError's message.
 *
 * Closes the loop back into the conversation the action came from: without
 * this, the thread just stops at "I've proposed an action that needs
 * approval" forever — a human reviewing the pending-actions queue would
 * approve it, but nothing in the conversation itself would ever say what
 * happened. A SYSTEM-role message (same pattern as the "not configured yet"
 * notice in sendAiMessage) reports the outcome, and for a success carries
 * the same `{ calls: [...] }` toolCalls shape the Orchestrator itself
 * writes — so ConversationView renders it with the exact same tool-call UI,
 * no new rendering path needed. `AiAction.conversationId` is optional in
 * the schema (an action could in principle exist outside a conversation);
 * skip the append when it's null rather than guessing one.
 */
export async function approveAiAction(actor: AuthContext, actionId: string) {
  await assertPermission(actor, "ai_actions:update");
  const action = await approveAction(actionId, actor.userId);

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "ai_action.approved",
    entityType: "AiAction",
    entityId: action.id,
    afterState: action,
  });

  try {
    const output = await executeApprovedTool(
      action.toolName,
      action.proposedInput,
      {
        userId: actor.userId,
        conversationId: action.conversationId ?? undefined,
      },
    );
    const executed = await markActionExecuted(
      actionId,
      (output ?? {}) as Record<string, unknown>,
    );

    await recordAudit({
      actorUserId: actor.userId,
      actorType: "USER",
      action: "ai_action.executed",
      entityType: "AiAction",
      entityId: action.id,
      afterState: executed,
    });

    if (action.conversationId) {
      await appendMessage({
        conversationId: action.conversationId,
        role: "SYSTEM",
        content: `Approved action executed: ${action.toolName}.`,
        toolCalls: {
          calls: [
            {
              name: action.toolName,
              input: action.proposedInput,
              status: "executed",
              output,
            },
          ],
        },
      });
    }

    return executed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await markActionFailed(actionId, message);

    await recordAudit({
      actorUserId: actor.userId,
      actorType: "USER",
      action: "ai_action.execution_failed",
      entityType: "AiAction",
      entityId: action.id,
      metadata: { error: message },
    });

    if (action.conversationId) {
      await appendMessage({
        conversationId: action.conversationId,
        role: "SYSTEM",
        content: `Approved action failed: ${action.toolName} — ${message}`,
      });
    }

    return failed;
  }
}

export async function rejectAiAction(
  actor: AuthContext,
  actionId: string,
  input: RejectAiActionInput,
) {
  await assertPermission(actor, "ai_actions:update");
  const action = await rejectAction(
    actionId,
    actor.userId,
    input.rejectionReason,
  );

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "ai_action.rejected",
    entityType: "AiAction",
    entityId: action.id,
    afterState: action,
  });

  if (action.conversationId) {
    await appendMessage({
      conversationId: action.conversationId,
      role: "SYSTEM",
      content: `Action rejected: ${action.toolName} — ${input.rejectionReason}`,
    });
  }

  return action;
}
