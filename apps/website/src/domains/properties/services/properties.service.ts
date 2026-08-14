import "server-only";

import { triggerWorkflow } from "@stayw/ai-automation";
import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Property } from "@stayw/database";

export type { Property };

import {
  createPropertySchema,
  type CreatePropertyInput,
  type UpdatePropertyOccupancyInput,
  type UpdatePropertyStatusInput,
} from "../schemas/properties.schema";

import { recordAudit } from "@/platform/audit/record-audit";

export async function listProperties(actor: AuthContext) {
  await assertPermission(actor, "properties:read");
  return prisma.property.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function createProperty(
  actor: AuthContext,
  rawInput: CreatePropertyInput,
) {
  await assertPermission(actor, "properties:create");
  const input = createPropertySchema.parse(rawInput);

  const property = await prisma.property.create({ data: input });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "property.created",
    entityType: "Property",
    entityId: property.id,
    afterState: property,
  });

  await triggerWorkflow({
    workflowName: "property.created",
    triggerSource: "properties.service.createProperty",
    relatedEntityType: "Property",
    relatedEntityId: property.id,
    payload: {
      propertyId: property.id,
      name: property.name,
      internalCode: property.internalCode,
    },
  });

  return property;
}

export async function updatePropertyStatus(
  actor: AuthContext,
  propertyId: string,
  input: UpdatePropertyStatusInput,
) {
  await assertPermission(actor, "properties:update");

  const property = await prisma.property.update({
    where: { id: propertyId },
    data: { status: input.status },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "property.status_updated",
    entityType: "Property",
    entityId: property.id,
    afterState: property,
  });

  return property;
}

export async function updatePropertyOccupancy(
  actor: AuthContext,
  propertyId: string,
  input: UpdatePropertyOccupancyInput,
) {
  await assertPermission(actor, "properties:update");

  const property = await prisma.property.update({
    where: { id: propertyId },
    data: { maxOccupancy: input.maxOccupancy },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "property.occupancy_updated",
    entityType: "Property",
    entityId: property.id,
    afterState: property,
  });

  return property;
}

export async function deleteProperty(actor: AuthContext, propertyId: string) {
  await assertPermission(actor, "properties:delete");

  const property = await prisma.property.update({
    where: { id: propertyId },
    data: { deletedAt: new Date() },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "property.deleted",
    entityType: "Property",
    entityId: property.id,
    afterState: property,
  });

  return property;
}
