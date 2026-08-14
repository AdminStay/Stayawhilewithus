import "server-only";

import { closeConversation } from "../conversations/repository";
import { createLogger } from "../logging/logger";

import type { EscalateConversationInput } from "./types";

const logger = createLogger("handoff");

/**
 * The package-level half of human handoff: transitions the conversation to
 * ESCALATED and logs why. Same package/domain split as everywhere else in
 * this platform — this has no permission check and doesn't notify anyone;
 * the domain layer (apps/website's ai.service.ts) is responsible for
 * `assertPermission`, creating a Notification for ops staff, and writing
 * the audit entry, the same way platform/notifications' createNotification
 * is a capability the domain layer calls, not a domain feature itself.
 */
export async function escalateConversation(input: EscalateConversationInput) {
  logger.info("conversation escalated", {
    conversationId: input.conversationId,
    reason: input.reason,
    details: input.details,
  });

  return closeConversation(input.conversationId, "ESCALATED");
}
