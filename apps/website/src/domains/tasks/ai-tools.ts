import "server-only";

import { registerTool } from "@stayw/ai";
import { z } from "zod";

import { completeTask, listTasks } from "./services/tasks.service";

const listInputSchema = z.object({});
const completeInputSchema = z.object({ taskId: z.string().min(1) });

/**
 * Registers this domain's AI-callable capabilities with @stayw/ai's Tool
 * Registry, wrapping the same service functions the /tasks page uses —
 * RBAC and the query/mutation shape stay in one place. Listing is read-only
 * (requiresApproval: false); marking a task complete is a real operational
 * change and requires human approval before it executes.
 */
export function registerTasksAiTools(): void {
  registerTool({
    name: "tasks.list",
    description: "Lists StayWhile operational tasks.",
    inputSchema: listInputSchema,
    requiresApproval: false,
    handler: async (_input, ctx) => {
      if (!ctx.userId) {
        throw new Error("tasks.list requires an authenticated userId.");
      }
      return listTasks({ userId: ctx.userId });
    },
  });

  registerTool({
    name: "tasks.complete",
    description: "Marks a task as done.",
    inputSchema: completeInputSchema,
    requiresApproval: true,
    handler: async (input, ctx) => {
      if (!ctx.userId) {
        throw new Error("tasks.complete requires an authenticated userId.");
      }
      return completeTask({ userId: ctx.userId }, input.taskId);
    },
  });
}
