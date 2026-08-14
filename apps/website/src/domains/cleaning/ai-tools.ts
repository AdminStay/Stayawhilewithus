import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import {
  completeCleaningSchedule,
  listCleaningSchedules,
} from "./services/cleaning.service";

const listInputSchema = z.object({});
const completeInputSchema = z.object({ scheduleId: z.string().min(1) });

/**
 * Registers this domain's AI-callable capabilities with @stayw/ai's Tool
 * Registry, wrapping the same service functions the /cleaning page uses —
 * RBAC and the query/mutation shape stay in one place. Listing is read-only
 * (requiresApproval: false); marking a cleaning schedule complete is a real
 * operational change and requires human approval before it executes.
 */
export function registerCleaningAiTools(): void {
  registerTool({
    name: "cleaning.list",
    description: "Lists StayWhile cleaning schedules.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("cleaning.list requires an authenticated userId.");
      }
      return listCleaningSchedules({ userId: ctx.userId });
    },
  });

  registerTool({
    name: "cleaning.complete",
    description: "Marks a cleaning schedule as completed.",
    inputSchema: completeInputSchema,
    requiresApproval: true,
    handler: async (input, ctx) => {
      if (!ctx.userId) {
        throw new Error("cleaning.complete requires an authenticated userId.");
      }
      return completeCleaningSchedule({ userId: ctx.userId }, input.scheduleId);
    },
  });
}
