import { hasPermission } from "@stayw/auth";
import { DialogTrigger, PageHeader } from "@stayw/ui";

import { listCurrentCleanerSummaries } from "@/domains/cleaners/services/cleaner-assignments.service";
import { CreatePropertyForm } from "@/domains/properties/components/CreatePropertyForm";
import { PropertyList } from "@/domains/properties/components/PropertyList";
import { PropertyStatusFilterTabs } from "@/domains/properties/components/PropertyStatusFilterTabs";
import {
  filterAndSortProperties,
  parsePropertyStatusFilter,
  propertyStatusFilterCounts,
  type PropertyStatusFilter,
} from "@/domains/properties/lib/property-status-filter";
import { listProperties } from "@/domains/properties/services/properties.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

const EMPTY_STATE: Record<
  PropertyStatusFilter,
  { title: string; description: string }
> = {
  operational: {
    title: "No operational properties",
    description: "Active and onboarding properties appear here.",
  },
  inactive: {
    title: "No inactive properties",
    description: "Inactive and offboarded properties appear here.",
  },
  all: {
    title: "No properties yet",
    description: "Add your first property to get started.",
  },
};

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getCurrentUser();
  const filter = parsePropertyStatusFilter((await searchParams).status);
  const [properties, canReadCleaners] = await Promise.all([
    listProperties(actor),
    hasPermission(actor, "cleaners:read"),
  ]);
  // The "Cleaner" column only exists for someone who can see cleaners.
  const cleanerSummaries = canReadCleaners
    ? await listCurrentCleanerSummaries(actor)
    : null;
  // 2026-10-07: Operational (ACTIVE + ONBOARDING, default) / Inactive / All.
  const counts = propertyStatusFilterCounts(properties);
  const shown = filterAndSortProperties(properties, filter);

  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle={`${counts.operational} operational ${counts.operational === 1 ? "property" : "properties"} under management`}
        actions={
          <DialogTrigger label="Add property" title="Add property">
            <CreatePropertyForm />
          </DialogTrigger>
        }
      />
      <PropertyStatusFilterTabs current={filter} counts={counts} />
      <PropertyList
        properties={shown}
        cleanerSummaries={cleanerSummaries}
        emptyTitle={EMPTY_STATE[filter].title}
        emptyDescription={EMPTY_STATE[filter].description}
      />
    </div>
  );
}
