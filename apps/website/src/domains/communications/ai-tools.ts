import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { sendMessageSchema } from "./schemas/communications.schema";
import {
  listMessageThreads,
  sendMessage,
} from "./services/communications.service";

const listInputSchema = z.object({});
const sendMessageInputSchema = sendMessageSchema.extend({
  threadId: z.string().min(1),
});

/**
 * Registers this domain's AI-callable capabilities with @stayw/ai's Tool
 * Registry, wrapping the same service functions the /communications page
 * uses — RBAC and the query/mutation shape stay in one place. Listing is
 * read-only (requiresApproval: false); sending a message reaches a real
 * guest or contact and requires human approval before it executes.
 */
export function registerCommunicationsAiTools(): void {
  registerTool({
    name: "communications.list",
    description: "Lists StayWhile message threads.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error(
          "communications.list requires an authenticated userId.",
        );
      }
      return listMessageThreads({ userId: ctx.userId });
    },
  });

  registerTool({
    name: "communications.sendMessage",
    description: "Sends an outbound message on an existing message thread.",
    inputSchema: sendMessageInputSchema,
    requiresApproval: true,
    handler: async (input, ctx) => {
      if (!ctx.userId) {
        throw new Error(
          "communications.sendMessage requires an authenticated userId.",
        );
      }
      const { threadId, ...rest } = input;
      return sendMessage({ userId: ctx.userId }, threadId, rest);
    },
  });
}
