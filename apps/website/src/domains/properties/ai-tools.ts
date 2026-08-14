import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { updatePropertyStatusSchema } from "./schemas/properties.schema";
import {
  listProperties,
  updatePropertyStatus,
} from "./services/properties.service";

const listInputSchema = z.object({});
const updateStatusInputSchema = updatePropertyStatusSchema.extend({
  propertyId: z.string().min(1),
});

/**
 * Registers this domain's AI-callable capabilities with @stayw/ai's Tool
 * Registry, wrapping the same service functions the /properties page uses —
 * RBAC and the query/mutation shape stay in one place. Listing is read-only
 * (requiresApproval: false); changing a property's status is a real
 * operational change and requires human approval before it executes.
 */
export function registerPropertiesAiTools(): void {
  registerTool({
    name: "properties.list",
    description: "Lists active StayWhile properties.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("properties.list requires an authenticated userId.");
      }
      return listProperties({ userId: ctx.userId });
    },
  });

  registerTool({
    name: "properties.updateStatus",
    description:
      "Changes a property's status (ACTIVE, INACTIVE, ONBOARDING, OFFBOARDED).",
    inputSchema: updateStatusInputSchema,
    requiresApproval: true,
    handler: async (input, ctx) => {
      if (!ctx.userId) {
        throw new Error(
          "properties.updateStatus requires an authenticated userId.",
        );
      }
      const { propertyId, ...rest } = input;
      return updatePropertyStatus({ userId: ctx.userId }, propertyId, rest);
    },
  });
}
