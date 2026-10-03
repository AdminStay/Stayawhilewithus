import { DialogTrigger, PageHeader, SectionHeader } from "@stayw/ui";

import {
  addCleanerContactAction,
  assignCleanerAction,
  createCleanerAction,
  endCleanerAssignmentAction,
  removeCleanerContactAction,
  setCleanerStatusAction,
  updateCleanerAction,
  updateCleanerContactAction,
} from "@/domains/cleaners/actions";
import { CleanerForm } from "@/domains/cleaners/components/CleanerForm";
import { CleanerList } from "@/domains/cleaners/components/CleanerList";
import { PropertyCleanerAssignments } from "@/domains/cleaners/components/PropertyCleanerAssignments";
import { listPropertyCleanerAssignments } from "@/domains/cleaners/services/cleaner-assignments.service";
import { listCleaners } from "@/domains/cleaners/services/cleaners.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Cleaners + property assignments — all dashboard-managed data (Cleaner
 * Assignments Phase 3). Requires cleaners:read; every write control is
 * shown only with cleaners:manage, and phone numbers arrive already
 * masked from the service for anyone without it.
 */
export default async function CleanersPage() {
  const actor = await getCurrentUser();
  const [{ cleaners, canManage }, rows] = await Promise.all([
    listCleaners(actor),
    listPropertyCleanerAssignments(actor),
  ]);

  const activeCleaners = cleaners
    .filter((c) => c.status === "ACTIVE")
    .map((c) => ({ id: c.id, name: c.name }));
  // Counts cover assignable (Active / Onboarding) properties only; rows for
  // inactive properties with leftover cleaners are listed but not counted.
  const assignableRows = rows.filter((r) => r.assignable);
  const unassigned = assignableRows.filter(
    (r) => r.primary === null && r.teamMembers.length === 0,
  ).length;
  const primaryNotSet = assignableRows.filter(
    (r) => r.primary === null && r.teamMembers.length > 0,
  ).length;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Cleaners"
        subtitle={`${activeCleaners.length} active ${activeCleaners.length === 1 ? "cleaner" : "cleaners"} · ${unassigned} ${unassigned === 1 ? "property" : "properties"} without a cleaner${primaryNotSet > 0 ? ` · ${primaryNotSet} without a primary` : ""}`}
        actions={
          canManage ? (
            <DialogTrigger label="Add cleaner" title="Add cleaner">
              <CleanerForm action={createCleanerAction} />
            </DialogTrigger>
          ) : undefined
        }
      />

      <section>
        <SectionHeader
          title="Property assignments"
          description="Active and Onboarding properties. One primary cleaner per property, plus any team members."
          size="lg"
        />
        <PropertyCleanerAssignments
          rows={rows}
          activeCleaners={activeCleaners}
          canManage={canManage}
          assignAction={assignCleanerAction}
          endAction={endCleanerAssignmentAction}
        />
      </section>

      <section>
        <SectionHeader title="Cleaners" size="lg" />
        <CleanerList
          cleaners={cleaners}
          canManage={canManage}
          updateAction={updateCleanerAction}
          setStatusAction={setCleanerStatusAction}
          contactActions={{
            add: addCleanerContactAction,
            update: updateCleanerContactAction,
            remove: removeCleanerContactAction,
          }}
        />
      </section>
    </div>
  );
}
