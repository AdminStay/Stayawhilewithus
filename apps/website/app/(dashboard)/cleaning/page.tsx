import { DialogTrigger, PageHeader } from "@stayw/ui";

import { CleaningScheduleList } from "@/domains/cleaning/components/CleaningScheduleList";
import { CreateCleaningScheduleForm } from "@/domains/cleaning/components/CreateCleaningScheduleForm";
import { listCleaningSchedules } from "@/domains/cleaning/services/cleaning.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { listReservations } from "@/domains/reservations/services/reservations.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function CleaningPage() {
  const actor = await getCurrentUser();
  const [schedules, properties, reservations] = await Promise.all([
    listCleaningSchedules(actor),
    listProperties(actor),
    listReservations(actor),
  ]);

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
            />
          </DialogTrigger>
        }
      />
      <CleaningScheduleList schedules={schedules} />
    </div>
  );
}
