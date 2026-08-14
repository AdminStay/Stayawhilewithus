import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Task } from "@stayw/database";

export type { Task };

import type { CreateTaskInput } from "../schemas/tasks.schema";

import { recordAudit } from "@/platform/audit/record-audit";

export async function listTasks(actor: AuthContext) {
  await assertPermission(actor, "tasks:read");
  return prisma.task.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { property: true, assignedTo: true },
  });
}

export async function createTask(actor: AuthContext, input: CreateTaskInput) {
  await assertPermission(actor, "tasks:create");

  const task = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description || undefined,
      type: input.type,
      priority: input.priority,
      propertyId: input.propertyId || undefined,
      dueAt: input.dueAt,
      createdByUserId: actor.userId,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "task.created",
    entityType: "Task",
    entityId: task.id,
    afterState: task,
  });

  return task;
}

export async function completeTask(actor: AuthContext, taskId: string) {
  await assertPermission(actor, "tasks:update");

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE", completedAt: new Date() },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "task.completed",
    entityType: "Task",
    entityId: task.id,
    afterState: task,
  });

  return task;
}

/**
 * There's no Users domain yet (not part of Increment 1's core-ops list), so
 * this lives here rather than behind a dedicated service — it's the minimal
 * read needed to populate an assignment dropdown, gated by the same
 * permission as seeing the task list at all.
 */
export async function listAssignableUsers(actor: AuthContext) {
  await assertPermission(actor, "tasks:read");
  return prisma.user.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
}

export async function assignTask(
  actor: AuthContext,
  taskId: string,
  assignedToUserId: string | null,
) {
  await assertPermission(actor, "tasks:update");

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { assignedToUserId },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "task.assigned",
    entityType: "Task",
    entityId: task.id,
    afterState: task,
  });

  return task;
}
