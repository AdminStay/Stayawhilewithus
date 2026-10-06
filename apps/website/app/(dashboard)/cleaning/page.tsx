import { ForbiddenError, hasPermission } from "@stayw/auth";
import { DialogTrigger, PageHeader } from "@stayw/ui";

import { listCurrentPropertyCleanerOptions } from "@/domains/cleaners/services/cleaner-assignments.service";
import { listActiveCleanerOptions } from "@/domains/cleaners/services/cleaners.service";
import {
  assignCleaningScheduleCleanerAction,
  createCleaningScheduleAction,
  markCleanerNotifiedAction,
} from "@/domains/cleaning/actions";
import type { CleanerNotificationView } from "@/domains/cleaning/components/CleanerNotifiedControl";
import { CleaningScheduleList } from "@/domains/cleaning/components/CleaningScheduleList";
import { CreateCleaningScheduleForm } from "@/domains/cleaning/components/CreateCleaningScheduleForm";
import { NeedsCleanerNotice } from "@/domains/cleaning/components/NeedsCleanerNotice";
import type { CleanerNotificationRecord } from "@/domains/cleaning/lib/cleaner-notification";
import {
  jobsNeedingCleaner,
  NEEDS_CLEANER_VIEW,
} from "@/domains/cleaning/lib/needs-cleaner";
import { listLatestCleanerNotifications } from "@/domains/cleaning/services/cleaner-notifications.service";
import { hasCleaningPermissionAnywhere } from "@/domains/cleaning/services/cleaning-access";
import {
  canChangeCleaningCleaner,
  listCleaningSchedules,
} from "@/domains/cleaning/services/cleaning.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { listReservations } from "@/domains/reservations/services/reservations.service";
import { formatTimestamp } from "@/domains/smart-devices/lib/format-timestamp";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Cleaner Phase 4: each cleaning shows its stored cleaner (or "Needs
 * cleaner", with the team for a property that has no primary) to viewers
 * with cleaners:read — names only, no phone numbers. The per-job cleaner
 * picker, and choosing a non-default cleaner when scheduling, are admin
 * only (canChangeCleaningCleaner; the server enforces it again).
 */
/**
 * A property-scoped cleaner can't read properties/reservations (they're not
 * in that role) — the page still works for them; the create form, which is
 * the only thing that needs those lists, isn't offered without create.
 */
async function orEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof ForbiddenError) return [];
    throw err;
  }
}

export default async function CleaningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getCurrentUser();
  const { view } = await searchParams;
  // listCleaningSchedules is property-scoped on the server (2026-10-07):
  // a cleaner sees only their properties' cleanings.
  const [
    schedules,
    properties,
    reservations,
    canSeeCleaners,
    canChange,
    canCreate,
    canUpdate,
  ] = await Promise.all([
    listCleaningSchedules(actor),
    orEmpty(() => listProperties(actor)),
    orEmpty(() => listReservations(actor)),
    hasPermission(actor, "cleaners:read"),
    canChangeCleaningCleaner(actor),
    hasCleaningPermissionAnywhere(actor, "cleaning_schedules:create"),
    hasCleaningPermissionAnywhere(actor, "cleaning_schedules:update"),
  ]);

  const isAdmin = canSeeCleaners && canChange;
  const [propertyCleaners, activeCleaners, latestNotifications] = canSeeCleaners
    ? await Promise.all([
        listCurrentPropertyCleanerOptions(actor),
        canChange ? listActiveCleanerOptions(actor) : Promise.resolve([]),
        // Phase 5.2: admin only — read from the audit trail, never sent.
        isAdmin
          ? listLatestCleanerNotifications(
              actor,
              schedules.map((s) => s.id),
            )
          : Promise.resolve(new Map<string, CleanerNotificationRecord>()),
      ])
    : [{}, [], new Map<string, CleanerNotificationRecord>()];
  const notifications: Record<string, CleanerNotificationView> = {};
  for (const [scheduleId, n] of latestNotifications) {
    notifications[scheduleId] = {
      cleanerId: n.cleanerId,
      cleanerName: n.cleanerName,
      notifiedAtLabel: formatTimestamp(n.notifiedAt),
      notifiedByName: n.notifiedByName,
    };
  }

  // Phase 5.3: open jobs with no cleaner. Only with cleaners:read — for
  // anyone else cleanerId is hidden, so the notice and filter don't apply.
  const needingCleaner = canSeeCleaners ? jobsNeedingCleaner(schedules) : [];
  const filtered = canSeeCleaners && view === NEEDS_CLEANER_VIEW;
  const shownSchedules = filtered ? needingCleaner : schedules;

  return (
    <div>
      <PageHeader
        title="Cleaning"
        subtitle={`${schedules.length} ${schedules.length === 1 ? "schedule" : "schedules"} on the calendar`}
        actions={
          canCreate && (
            <DialogTrigger label="Schedule cleaning" title="Schedule cleaning">
              <CreateCleaningScheduleForm
                properties={properties}
                reservations={reservations}
                cleaners={
                  canSeeCleaners
                    ? { propertyCleaners, activeCleaners, canChoose: canChange }
                    : undefined
                }
                action={createCleaningScheduleAction}
              />
            </DialogTrigger>
          )
        }
      />
      {canSeeCleaners && (
        <NeedsCleanerNotice count={needingCleaner.length} filtered={filtered} />
      )}
      {!(filtered && needingCleaner.length === 0) && (
        <CleaningScheduleList
          schedules={shownSchedules}
          canUpdate={canUpdate}
          cleaners={{
            canSeeCleaners,
            canChangeCleaner: isAdmin,
            propertyCleaners,
            activeCleaners,
            assignCleanerAction: assignCleaningScheduleCleanerAction,
            ...(isAdmin
              ? { notifications, markNotifiedAction: markCleanerNotifiedAction }
              : {}),
          }}
        />
      )}
    </div>
  );
}
