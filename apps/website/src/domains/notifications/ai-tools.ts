import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { listNotifications } from "./services/notifications.service";

const listInputSchema = z.object({});

/**
 * Registers this domain's read-only capability with @stayw/ai's Tool
 * Registry, wrapping the same listNotifications() the /notifications page
 * uses — always scoped to the calling user, same as the page itself.
 * Read-only: marking a notification read is a per-user UI action, not
 * something the assistant needs to do on someone's behalf.
 */
export function registerNotificationsAiTools(): void {
  registerTool({
    name: "notifications.list",
    description: "Lists the calling user's StayWhile notifications.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("notifications.list requires an authenticated userId.");
      }
      return listNotifications({ userId: ctx.userId });
    },
  });
}
