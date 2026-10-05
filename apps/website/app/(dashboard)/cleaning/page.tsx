import { hasPermission } from "@stayw/auth";
import { DialogTrigger, PageHeader } from "@stayw/ui";

import { listCurrentPropertyCleanerOptions } from "@/domains/cleaners/services/cleaner-assignments.service";
import { listActiveCleanerOptions } from "@/domains/cleaners/services/cleaners.service";
import {
  assignCleaningScheduleCleanerAction,
  createCleaningScheduleAction,
} from "@/domains/cleaning/actions";
import { CleaningScheduleList } from "@/domains/cleaning/components/CleaningScheduleList";
import { CreateCleaningScheduleForm } from "@/domains/cleaning/components/CreateCleaningScheduleForm";
import {
  canChangeCleaningCleaner,
  listCleaningSchedules,
} from "@/domains/cleaning/services/cleaning.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { listReservations } from "@/domains/reservations/services/reservations.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Cleaner Phase 4: each cleaning shows its stored cleaner (or "Needs
 * cleaner", with the team for a property that has no primary) to viewers
 * with cleaners:read — names only, no phone numbers. The per-job cleaner
 * picker, and choosing a non-default cleaner when scheduling, are admin
 * only (canChangeCleaningCleaner; the server enforces it again).
 */
export default async function CleaningPage() {
  const actor = await getCurrentUser();
  const [schedules, properties, reservations, canSeeCleaners, canChange] =
    await Promise.all([
      listCleaningSchedules(actor),
      listProperties(actor),
      listReservations(actor),
      hasPermission(actor, "cleaners:read"),
      canChangeCleaningCleaner(actor),
    ]);

  const [propertyCleaners, activeCleaners] = canSeeCleaners
    ? await Promise.all([
        listCurrentPropertyCleanerOptions(actor),
        canChange ? listActiveCleanerOptions(actor) : Promise.resolve([]),
      ])
    : [{}, []];

  return (
    <div>
      <PageHeader
        title="Cleaning"
        subtitle={`${schedules.length} ${schedules.length === 1 ? "schedule" : "schedules"} on the calendar`}
        actions={
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
        }
      />
      <CleaningScheduleList
        schedules={schedules}
        cleaners={{
          canSeeCleaners,
          canChangeCleaner: canSeeCleaners && canChange,
          propertyCleaners,
          activeCleaners,
          assignCleanerAction: assignCleaningScheduleCleanerAction,
        }}
      />
    </div>
  );
}
