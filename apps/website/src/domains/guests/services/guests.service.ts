import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Guest } from "@stayw/database";

export type { Guest };

import type {
  CreateGuestInput,
  UpdateGuestInput,
} from "../schemas/guests.schema";

import { recordAudit } from "@/platform/audit/record-audit";

export async function listGuests(actor: AuthContext) {
  await assertPermission(actor, "guests:read");
  return prisma.guest.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function createGuest(actor: AuthContext, input: CreateGuestInput) {
  await assertPermission(actor, "guests:create");

  const guest = await prisma.guest.create({
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email || undefined,
      phone: input.phone || undefined,
      notes: input.notes || undefined,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "guest.created",
    entityType: "Guest",
    entityId: guest.id,
    afterState: guest,
  });

  return guest;
}

export async function updateGuest(
  actor: AuthContext,
  guestId: string,
  input: UpdateGuestInput,
) {
  await assertPermission(actor, "guests:update");

  const guest = await prisma.guest.update({
    where: { id: guestId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email || undefined,
      phone: input.phone || undefined,
      notes: input.notes || undefined,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "guest.updated",
    entityType: "Guest",
    entityId: guest.id,
    afterState: guest,
  });

  return guest;
}

export async function deleteGuest(actor: AuthContext, guestId: string) {
  await assertPermission(actor, "guests:delete");

  const guest = await prisma.guest.update({
    where: { id: guestId },
    data: { deletedAt: new Date() },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "guest.deleted",
    entityType: "Guest",
    entityId: guest.id,
    afterState: guest,
  });

  return guest;
}
