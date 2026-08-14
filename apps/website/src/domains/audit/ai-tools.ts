import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { listAuditLogs } from "./services/audit.service";

const listInputSchema = z.object({});

/**
 * Registers this domain's read-only capability with @stayw/ai's Tool
 * Registry, wrapping the same listAuditLogs() the /audit page uses — RBAC
 * stays in one place. Read-only: the audit log is an append-only record
 * written by other domains' services, never by the assistant directly.
 */
export function registerAuditAiTools(): void {
  registerTool({
    name: "audit.list",
    description: "Lists recent StayWhile audit log entries.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("audit.list requires an authenticated userId.");
      }
      return listAuditLogs({ userId: ctx.userId });
    },
  });
}
