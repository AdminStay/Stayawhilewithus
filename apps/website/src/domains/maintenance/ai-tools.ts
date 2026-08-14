import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { resolveMaintenanceRequestSchema } from "./schemas/maintenance.schema";
import {
  listMaintenanceRequests,
  resolveMaintenanceRequest,
} from "./services/maintenance.service";

const listInputSchema = z.object({});
const resolveInputSchema = resolveMaintenanceRequestSchema.extend({
  requestId: z.string().min(1),
});

/**
 * Registers this domain's AI-callable capabilities with @stayw/ai's Tool
 * Registry, wrapping the same service functions the /maintenance page uses
 * — RBAC and the query/mutation shape stay in one place. Listing is
 * read-only (requiresApproval: false); resolving a maintenance request is a
 * real operational change and requires human approval before it executes.
 */
export function registerMaintenanceAiTools(): void {
  registerTool({
    name: "maintenance.list",
    description: "Lists StayWhile maintenance requests.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("maintenance.list requires an authenticated userId.");
      }
      return listMaintenanceRequests({ userId: ctx.userId });
    },
  });

  registerTool({
    name: "maintenance.resolve",
    description: "Marks a maintenance request as resolved.",
    inputSchema: resolveInputSchema,
    requiresApproval: true,
    handler: async (input, ctx) => {
      if (!ctx.userId) {
        throw new Error(
          "maintenance.resolve requires an authenticated userId.",
        );
      }
      const { requestId, ...rest } = input;
      return resolveMaintenanceRequest({ userId: ctx.userId }, requestId, rest);
    },
  });
}
