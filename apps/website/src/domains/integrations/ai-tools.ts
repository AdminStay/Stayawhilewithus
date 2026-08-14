import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { listIntegrationConnections } from "./services/integrations.service";

const listInputSchema = z.object({});

/**
 * Registers this domain's read-only capability with @stayw/ai's Tool
 * Registry, wrapping the same listIntegrationConnections() the
 * /integrations page uses — RBAC stays in one place. Read-only: connecting
 * or disconnecting an external service is an infrastructure change, not
 * something this session exposes to the assistant.
 */
export function registerIntegrationsAiTools(): void {
  registerTool({
    name: "integrations.list",
    description:
      "Lists StayWhile's external integration connections and their status.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("integrations.list requires an authenticated userId.");
      }
      return listIntegrationConnections({ userId: ctx.userId });
    },
  });
}
