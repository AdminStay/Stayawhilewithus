import "server-only";

import { ForbiddenError, type AuthContext } from "@stayw/auth";

import {
  listAiConversations,
  listPendingAiActions,
} from "@/domains/ai/services/ai.service";
import {
  listCleaningSchedules,
  listRecentlyRescheduledCleanings,
} from "@/domains/cleaning/services/cleaning.service";
import { listMessageThreads } from "@/domains/communications/services/communications.service";
import { listGuests } from "@/domains/guests/services/guests.service";
import {
  getNotionHighlights,
  getOwnerRezHighlights,
  listIntegrationConnections,
} from "@/domains/integrations/services/integrations.service";
import { listMaintenanceRequests } from "@/domains/maintenance/services/maintenance.service";
import { listNotifications } from "@/domains/notifications/services/notifications.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { listReservations } from "@/domains/reservations/services/reservations.service";
import {
  isDemoSmartDevice,
  isLowBattery,
  listSmartDevices,
} from "@/domains/smart-devices/services/smart-devices.service";
import { listTasks } from "@/domains/tasks/services/tasks.service";

/**
 * Resolves to `[]` when the actor lacks the underlying permission, rather
 * than rejecting — the dashboard is a best-effort summary composed from
 * whichever domains the actor can actually see, not an all-or-nothing view.
 * Any other error still propagates.
 */
export async function safeList<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return [];
    throw err;
  }
}

/** Same graceful-degradation contract as safeList(), for calls that return a single value rather than an array. */
async function safeResult<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return fallback;
    throw err;
  }
}

/** "Today" as a UTC calendar day, matching how packages/database/prisma/seed.ts constructs its demo dates — @db.Date columns round-trip through Prisma via their UTC Y/M/D, so comparing on local server time directly would misalign by a day whenever the server isn't running in UTC. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function daysFromUtc(base: Date, n: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// How far ahead "upcoming" looks past today — a short, scannable window,
// not a full calendar/booking-management view (out of scope for the
// dashboard; the Reservations page is the place for that).
const UPCOMING_WINDOW_DAYS = 6;

/**
 * Composition root: no owned model, no permission key of its own. Every
 * field here comes from another domain's already-permission-checked
 * service — this never queries Prisma directly.
 */
export async function getDashboardSummary(actor: AuthContext) {
  const [
    properties,
    guests,
    reservations,
    tasks,
    cleaningSchedules,
    maintenanceRequests,
    notifications,
    messageThreads,
    pendingAiActions,
    integrationConnections,
    recentAiConversations,
    smartDevices,
    recentlyRescheduledCleanings,
    notionHighlights,
    ownerRezHighlights,
  ] = await Promise.all([
    safeList(() => listProperties(actor)),
    safeList(() => listGuests(actor)),
    safeList(() => listReservations(actor)),
    safeList(() => listTasks(actor)),
    safeList(() => listCleaningSchedules(actor)),
    safeList(() => listMaintenanceRequests(actor)),
    safeList(() => listNotifications(actor)),
    safeList(() => listMessageThreads(actor)),
    safeList(() => listPendingAiActions(actor)),
    safeList(() => listIntegrationConnections(actor)),
    safeList(() => listAiConversations(actor)),
    safeList(() => listSmartDevices(actor)),
    safeList(() => listRecentlyRescheduledCleanings(actor)),
    safeResult(() => getNotionHighlights(actor), {
      configured: false,
    } as const),
    safeResult(() => getOwnerRezHighlights(actor), {
      configured: false,
    } as const),
  ]);

  const today = todayUtc();

  const activeStatuses = new Set(["PENDING", "CONFIRMED", "CHECKED_IN"]);
  const arrivalsToday = reservations.filter(
    (r) =>
      activeStatuses.has(r.status) &&
      isSameUtcDay(new Date(r.checkInDate), today),
  );
  const departuresToday = reservations.filter(
    (r) =>
      activeStatuses.has(r.status) &&
      isSameUtcDay(new Date(r.checkOutDate), today),
  );

  const upcomingWindowEnd = daysFromUtc(today, UPCOMING_WINDOW_DAYS);
  const upcomingCheckIns = reservations
    .filter(
      (r) =>
        activeStatuses.has(r.status) &&
        new Date(r.checkInDate) > today &&
        new Date(r.checkInDate) <= upcomingWindowEnd,
    )
    .sort(
      (a, b) =>
        new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime(),
    );
  const upcomingCheckOuts = reservations
    .filter(
      (r) =>
        activeStatuses.has(r.status) &&
        new Date(r.checkOutDate) > today &&
        new Date(r.checkOutDate) <= upcomingWindowEnd,
    )
    .sort(
      (a, b) =>
        new Date(a.checkOutDate).getTime() - new Date(b.checkOutDate).getTime(),
    );
  const occupiedPropertyIds = new Set(
    reservations
      .filter(
        (r) =>
          (r.status === "CONFIRMED" || r.status === "CHECKED_IN") &&
          new Date(r.checkInDate) <= today &&
          today <= new Date(r.checkOutDate),
      )
      .map((r) => r.propertyId),
  );
  const occupancyRate =
    properties.length > 0 ? occupiedPropertyIds.size / properties.length : 0;

  const tasksDueToday = tasks.filter(
    (t) =>
      t.dueAt &&
      t.status !== "DONE" &&
      t.status !== "CANCELLED" &&
      isSameUtcDay(new Date(t.dueAt), today),
  );
  const cleaningToday = cleaningSchedules.filter((c) =>
    isSameUtcDay(new Date(c.scheduledDate), today),
  );

  const locks = smartDevices.filter((d) => d.deviceType === "LOCK");
  const thermostats = smartDevices.filter((d) => d.deviceType === "THERMOSTAT");
  const devicesNeedingAttention = smartDevices.filter(
    (d) => d.status !== "ONLINE" || isLowBattery(d),
  );
  // Per-row, not per-provider: a provider's packages/integrations client
  // being "real" (see PROVIDER_CLIENT_STATUS) doesn't mean THIS row came
  // from a real sync — a given environment might have real August
  // credentials but no Cielo ones yet, or credentials configured but no
  // sync run yet. isDemoSmartDevice() checks the row's own
  // externalDeviceId, which seedDemoSmartDevices() is the only thing that
  // ever prefixes with "demo-" — a real lockId/MAC address can't collide
  // with that, and it self-corrects the moment a real sync overwrites or
  // prunes a demo row, no dashboard code change needed.
  const hasLiveDeviceData = smartDevices.some((d) => !isDemoSmartDevice(d));

  return {
    properties,
    guests,
    reservations,
    tasks,
    cleaningSchedules,
    maintenanceRequests,
    notifications,
    messageThreads,
    pendingAiActions,
    integrationConnections,
    recentAiConversations: recentAiConversations.slice(0, 5),
    smartDevices,
    locks,
    thermostats,
    devicesNeedingAttention,
    offlineDeviceCount: smartDevices.filter((d) => d.status !== "ONLINE")
      .length,
    lowBatteryDeviceCount: smartDevices.filter((d) => isLowBattery(d)).length,
    hasLiveDeviceData,
    recentlyRescheduledCleanings,
    notionHighlights,
    ownerRezHighlights,
    openTasks: tasks.filter(
      (t) => t.status === "TODO" || t.status === "IN_PROGRESS",
    ),
    upcomingCleaningSchedules: cleaningSchedules.filter(
      (c) => c.status === "SCHEDULED",
    ),
    openMaintenanceRequests: maintenanceRequests.filter(
      (r) => r.status === "OPEN" || r.status === "IN_PROGRESS",
    ),
    unreadNotifications: notifications.filter((n) => !n.readAt),
    connectedIntegrations: integrationConnections.filter(
      (c) => c.status === "CONNECTED",
    ),
    arrivalsToday,
    departuresToday,
    upcomingCheckIns,
    upcomingCheckOuts,
    occupancyRate,
    occupiedPropertyCount: occupiedPropertyIds.size,
    tasksDueToday,
    cleaningToday,
  };
}
