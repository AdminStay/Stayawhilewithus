import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type ResourceLink } from "@stayw/database";

export type { ResourceLink };

import type {
  CreateResourceLinkInput,
  UpdateResourceLinkInput,
} from "../schemas/resource-links.schema";

import { recordAudit } from "@/platform/audit/record-audit";

/** Soft-deleted rows (deletedAt set) are never returned — see the model's own doc comment in schema.prisma. */
export async function listResourceLinks(actor: AuthContext) {
  await assertPermission(actor, "resource_links:read");
  return prisma.resourceLink.findMany({
    where: { deletedAt: null },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { property: true },
  });
}

export async function createResourceLink(
  actor: AuthContext,
  input: CreateResourceLinkInput,
) {
  await assertPermission(actor, "resource_links:create");

  const resourceLink = await prisma.resourceLink.create({
    data: {
      name: input.name,
      url: input.url,
      description: input.description || undefined,
      category: input.category,
      propertyId: input.propertyId || undefined,
      createdByUserId: actor.userId,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "resource_link.created",
    entityType: "ResourceLink",
    entityId: resourceLink.id,
    afterState: resourceLink,
  });

  return resourceLink;
}

export async function updateResourceLink(
  actor: AuthContext,
  input: UpdateResourceLinkInput,
) {
  await assertPermission(actor, "resource_links:update");

  const resourceLink = await prisma.resourceLink.update({
    where: { id: input.id },
    data: {
      name: input.name,
      url: input.url,
      description: input.description || null,
      category: input.category,
      propertyId: input.propertyId || null,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "resource_link.updated",
    entityType: "ResourceLink",
    entityId: resourceLink.id,
    afterState: resourceLink,
  });

  return resourceLink;
}

/** Soft delete only — sets deletedAt, never removes the row. See the model's own doc comment in schema.prisma for why. */
export async function deleteResourceLink(actor: AuthContext, id: string) {
  await assertPermission(actor, "resource_links:delete");

  const resourceLink = await prisma.resourceLink.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "resource_link.deleted",
    entityType: "ResourceLink",
    entityId: resourceLink.id,
    afterState: resourceLink,
  });

  return resourceLink;
}
