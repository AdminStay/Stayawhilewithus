import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  buildUnmappedAugustDevices,
  type UnmappedAugustDevice,
} from "../lib/unmapped-august-devices";

/**
 * Read-only (smart_devices:read): discovered August locks that are not on
 * Fleet Status. One database read of stored discovery data — no provider
 * call, no write, no mapping change.
 */
export async function listUnmappedAugustDevices(
  actor: AuthContext,
): Promise<{ devices: UnmappedAugustDevice[]; retiredCount: number }> {
  await assertPermission(actor, "smart_devices:read");
  const rows = await prisma.providerDevice.findMany({
    where: {
      deviceType: "LOCK",
      integrationConnection: { provider: "AUGUST" },
    },
    select: {
      id: true,
      discoveredName: true,
      connectivityStatus: true,
      rawMetadata: true,
      lastSeenAt: true,
      propertyId: true,
      enabled: true,
      smartDeviceId: true,
      smartDevice: { select: { metadata: true } },
    },
  });
  return buildUnmappedAugustDevices(
    rows.map(({ smartDevice, ...row }) => ({
      ...row,
      smartDeviceMetadata: smartDevice?.metadata ?? null,
    })),
  );
}
