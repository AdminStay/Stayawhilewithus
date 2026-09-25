import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read-only: how many times each lock went from a known state to "unknown"
 * in the last 24h, from the LOCK_STATE_CHANGED rows the refresh paths
 * record (lib/lock-health.ts). Feeds classifyLockHealth()'s "frequent
 * unknown" rule. Makes no provider call and writes nothing.
 */
export async function getRecentUnknownTransitionCounts(
  actor: AuthContext,
  smartDeviceIds: string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  await assertPermission(actor, "smart_devices:read");
  if (smartDeviceIds.length === 0) return new Map();

  const rows = await prisma.smartDeviceEvent.findMany({
    where: {
      smartDeviceId: { in: smartDeviceIds },
      eventType: "LOCK_STATE_CHANGED",
      occurredAt: { gte: new Date(now.getTime() - DAY_MS) },
    },
    select: { smartDeviceId: true, payload: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    const payload = row.payload as { to?: unknown } | null;
    if (payload?.to !== "unknown") continue;
    counts.set(row.smartDeviceId, (counts.get(row.smartDeviceId) ?? 0) + 1);
  }
  return counts;
}
