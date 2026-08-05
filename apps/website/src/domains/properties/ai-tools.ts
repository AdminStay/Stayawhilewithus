import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { listProperties } from "./services/properties.service";

const listInputSchema = z.object({});

/**
 * Proof-of-concept: registers this domain's read-only capability with
 * @stayw/ai's Tool Registry, wrapping the same listProperties() the
 * /properties page uses — RBAC and the query shape stay in one place.
 * requiresApproval is false because listing is read-only.
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
}
