import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { updateReservationStatusSchema } from "./schemas/reservations.schema";
import {
  listReservations,
  updateReservationStatus,
} from "./services/reservations.service";

const listInputSchema = z.object({});
const updateStatusInputSchema = updateReservationStatusSchema.extend({
  reservationId: z.string().min(1),
});

/**
 * Registers this domain's AI-callable capabilities with @stayw/ai's Tool
 * Registry, wrapping the same service functions the /reservations page
 * uses — RBAC and the query/mutation shape stay in one place. Listing is
 * read-only (requiresApproval: false); changing a reservation's status
 * (including cancelling it) is a real operational change and requires
 * human approval before it executes.
 */
export function registerReservationsAiTools(): void {
  registerTool({
    name: "reservations.list",
    description: "Lists StayWhile reservations.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("reservations.list requires an authenticated userId.");
      }
      return listReservations({ userId: ctx.userId });
    },
  });

  registerTool({
    name: "reservations.updateStatus",
    description:
      "Changes a reservation's status (PENDING, CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED).",
    inputSchema: updateStatusInputSchema,
    requiresApproval: true,
    handler: async (input, ctx) => {
      if (!ctx.userId) {
        throw new Error(
          "reservations.updateStatus requires an authenticated userId.",
        );
      }
      const { reservationId, ...rest } = input;
      return updateReservationStatus(
        { userId: ctx.userId },
        reservationId,
        rest,
      );
    },
  });
}
