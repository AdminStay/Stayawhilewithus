import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { updateGuestSchema } from "./schemas/guests.schema";
import { listGuests, updateGuest } from "./services/guests.service";

const listInputSchema = z.object({});
const updateInputSchema = updateGuestSchema.extend({
  guestId: z.string().min(1),
});

/**
 * Registers this domain's AI-callable capabilities with @stayw/ai's Tool
 * Registry, wrapping the same service functions the /guests page uses —
 * RBAC and the query/mutation shape stay in one place. Listing is read-only
 * (requiresApproval: false); updating a guest's contact details is a real
 * change to guest data and requires human approval before it executes.
 */
export function registerGuestsAiTools(): void {
  registerTool({
    name: "guests.list",
    description: "Lists StayWhile guests.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("guests.list requires an authenticated userId.");
      }
      return listGuests({ userId: ctx.userId });
    },
  });

  registerTool({
    name: "guests.update",
    description: "Updates a guest's contact details or notes.",
    inputSchema: updateInputSchema,
    requiresApproval: true,
    handler: async (input, ctx) => {
      if (!ctx.userId) {
        throw new Error("guests.update requires an authenticated userId.");
      }
      const { guestId, ...rest } = input;
      return updateGuest({ userId: ctx.userId }, guestId, rest);
    },
  });
}
