import { hasPermission } from "@stayw/auth";
import { DialogTrigger, PageHeader } from "@stayw/ui";

import { listCurrentCleanerSummaries } from "@/domains/cleaners/services/cleaner-assignments.service";
import { CreatePropertyForm } from "@/domains/properties/components/CreatePropertyForm";
import { PropertyList } from "@/domains/properties/components/PropertyList";
import { listProperties } from "@/domains/properties/services/properties.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function PropertiesPage() {
  const actor = await getCurrentUser();
  const [properties, canReadCleaners] = await Promise.all([
    listProperties(actor),
    hasPermission(actor, "cleaners:read"),
  ]);
  // The "Cleaner" column only exists for someone who can see cleaners.
  const cleanerSummaries = canReadCleaners
    ? await listCurrentCleanerSummaries(actor)
    : null;

  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle={`${properties.length} ${properties.length === 1 ? "property" : "properties"} under management`}
        actions={
          <DialogTrigger label="Add property" title="Add property">
            <CreatePropertyForm />
          </DialogTrigger>
        }
      />
      <PropertyList
        properties={properties}
        cleanerSummaries={cleanerSummaries}
      />
    </div>
  );
}
