import "server-only";

import { ForbiddenError, type AuthContext } from "@stayw/auth";

import {
  listAiConversations,
  listPendingAiActions,
} from "@/domains/ai/services/ai.service";
import {
  listCleaningJobsNeedingCleaner,
  listCleaningSchedules,
  listRecentlyRescheduledCleanings,
} from "@/domains/cleaning/services/cleaning.service";
import { listMessageThreads } from "@/domains/communications/services/communications.service";
import { listGuests } from "@/domains/guests/services/guests.service";
import { ownerRezPropertyNameMap } from "@/domains/integrations/lib/ownerrez-property-names";
import {
  getNotionHighlights,
  getOwnerRezHighlights,
  listIntegrationConnections,
} from "@/domains/integrations/services/integrations.service";
import { listMaintenanceRequests } from "@/domains/maintenance/services/maintenance.service";
import { listNotifications } from "@/domains/notifications/services/notifications.service";
import { isOperationalProperty } from "@/domains/properties/lib/operational-properties";
import { listProperties } from "@/domains/properties/services/properties.service";
import {
  addCalendarDays,
  calendarDay,
  localDateInTimeZone,
} from "@/domains/reservations/lib/reservation-views";
import { listReservations } from "@/domains/reservations/services/reservations.service";
import {
  isDemoSmartDevice,
  isLowBattery,
  isTelemetryStale,
  listSmartDevices,
} from "@/domains/smart-devices/services/smart-devices.service";
import { listTasks } from "@/domains/tasks/services/tasks.service";
import { SCHEDULE_TIMEZONE } from "@/domains/team/services/chicago-date";
import { getTeamAvailabilitySnapshot } from "@/domains/team/services/schedule.service";

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

/**
 * Whether a date-only value (a @db.Date, or Task.dueAt, which is entered
 * as a date and stored as UTC midnight) falls on "today" in `timeZone`.
 * The value's own calendar day is read in UTC (calendarDay) and compared
 * with the local today — never with the server's UTC date, which rolled
 * "today" over at ~7–8 PM Eastern/Central. False when the zone can't be
 * resolved.
 */
function isLocalToday(value: Date, timeZone: string, now: Date): boolean {
  const localToday = localDateInTimeZone(now, timeZone);
  return localToday !== null && calendarDay(value) === localToday;
}

/**
 * A task's "today" zone: its property's timezone when that resolves,
 * otherwise StayWhile's single operating timezone (SCHEDULE_TIMEZONE) — a
 * task may have no property, and the operating zone is the established
 * dashboard-wide rule, not a guess.
 */
function taskTimeZone(
  property: { timezone: string } | null | undefined,
  now: Date,
): string {
  const zone = property?.timezone;
  return zone && localDateInTimeZone(now, zone) !== null
    ? zone
    : SCHEDULE_TIMEZONE;
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
    teamAvailability,
    cleaningJobsNeedingCleaner,
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
    safeResult(() => getTeamAvailabilitySnapshot(actor), {
      lastSyncedAt: null,
      isStale: true,
      lastFetchError: null,
      workingNow: [],
      comingUp: [],
      off: [],
      unmappedCount: 0,
    }),
    // Cleaner Phase 5.3: open jobs with no cleaner. Empty (no attention
    // row) for anyone without cleaning_schedules:read + cleaners:read.
    safeList(() => listCleaningJobsNeedingCleaner(actor)),
  ]);

  const activeStatuses = new Set(["PENDING", "CONFIRMED", "CHECKED_IN"]);
  // Reservations are compared against each property's OWN local today
  // (Property.timezone), not the server's UTC date, so "today" no longer
  // rolls over at ~7–8 PM Eastern/Central (2026-10-02). Only operational
  // properties (ACTIVE / ONBOARDING, not deleted) count. A property whose
  // timezone can't be resolved is left out of these date lists, never
  // guessed — the same rule as /reservations.
  const now = new Date();
  const operationalReservations = reservations
    .filter((r) => isOperationalProperty(r.property))
    .map((r) => ({
      r,
      localToday: localDateInTimeZone(now, r.property.timezone),
    }))
    .filter(
      (x): x is { r: (typeof reservations)[number]; localToday: string } =>
        x.localToday !== null,
    );
  const arrivalsToday = operationalReservations
    .filter(
      ({ r, localToday }) =>
        activeStatuses.has(r.status) &&
        calendarDay(r.checkInDate) === localToday,
    )
    .map(({ r }) => r);
  const departuresToday = operationalReservations
    .filter(
      ({ r, localToday }) =>
        activeStatuses.has(r.status) &&
        calendarDay(r.checkOutDate) === localToday,
    )
    .map(({ r }) => r);

  const upcomingCheckIns = operationalReservations
    .filter(({ r, localToday }) => {
      const day = calendarDay(r.checkInDate);
      return (
        activeStatuses.has(r.status) &&
        day > localToday &&
        day <= addCalendarDays(localToday, UPCOMING_WINDOW_DAYS)
      );
    })
    .map(({ r }) => r)
    .sort(
      (a, b) =>
        new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime(),
    );
  const upcomingCheckOuts = operationalReservations
    .filter(({ r, localToday }) => {
      const day = calendarDay(r.checkOutDate);
      return (
        activeStatuses.has(r.status) &&
        day > localToday &&
        day <= addCalendarDays(localToday, UPCOMING_WINDOW_DAYS)
      );
    })
    .map(({ r }) => r)
    .sort(
      (a, b) =>
        new Date(a.checkOutDate).getTime() - new Date(b.checkOutDate).getTime(),
    );
  const occupiedPropertyIds = new Set(
    operationalReservations
      .filter(
        ({ r, localToday }) =>
          (r.status === "CONFIRMED" || r.status === "CHECKED_IN") &&
          calendarDay(r.checkInDate) <= localToday &&
          localToday <= calendarDay(r.checkOutDate),
      )
      .map(({ r }) => r.propertyId),
  );
  const operationalPropertyCount = properties.filter(
    isOperationalProperty,
  ).length;
  const occupancyRate =
    operationalPropertyCount > 0
      ? occupiedPropertyIds.size / operationalPropertyCount
      : 0;

  // Tasks and cleanings use the same local-today rule as reservations
  // (2026-10-07). A cleaning uses its property's timezone (unresolvable →
  // left out, as above); a task uses taskTimeZone().
  const tasksDueToday = tasks.filter(
    (t) =>
      t.dueAt &&
      t.status !== "DONE" &&
      t.status !== "CANCELLED" &&
      isLocalToday(new Date(t.dueAt), taskTimeZone(t.property, now), now),
  );
  const cleaningToday = cleaningSchedules.filter((c) =>
    isLocalToday(new Date(c.scheduledDate), c.property.timezone, now),
  );

  const locks = smartDevices.filter((d) => d.deviceType === "LOCK");
  const thermostats = smartDevices.filter((d) => d.deviceType === "THERMOSTAT");
  // UNKNOWN (provider gave no reliable connectivity signal) is deliberately
  // NOT treated as needing attention on its own — that was the exact bug
  // this status model replaced (a device the provider simply didn't report
  // on was being shown as a critical Offline alert). A device only lands
  // here for an explicit OFFLINE report, low battery, or stale telemetry —
  // the last of which can affect an UNKNOWN-connectivity device too, so
  // staleness still surfaces even though bare UNKNOWN doesn't.
  const devicesNeedingAttention = smartDevices.filter(
    (d) => d.status === "OFFLINE" || isLowBattery(d) || isTelemetryStale(d),
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
    offlineDeviceCount: smartDevices.filter((d) => d.status === "OFFLINE")
      .length,
    lowBatteryDeviceCount: smartDevices.filter((d) => isLowBattery(d)).length,
    hasLiveDeviceData,
    recentlyRescheduledCleanings,
    cleaningJobsNeedingCleaner,
    notionHighlights,
    ownerRezHighlights,
    // OwnerRez property id → StayWhile property name (linked properties
    // only), so the OwnerRez card shows names, not numbers (2026-10-02).
    ownerRezPropertyNames: ownerRezPropertyNameMap(properties),
    teamAvailability,
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
    // ACTIVE + ONBOARDING, not deleted — the "Properties" tile's count.
    operationalPropertyCount,
    tasksDueToday,
    cleaningToday,
  };
}
