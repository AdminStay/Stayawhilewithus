import { PageHeader } from "@stayw/ui";

import { OwnerRezOverview } from "@/domains/integrations/components/OwnerRezOverview";
import {
  getOwnerRezHighlights,
  getOwnerRezProperties,
} from "@/domains/integrations/services/integrations.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function OwnerRezPage() {
  const actor = await getCurrentUser();
  const [properties, bookings] = await Promise.all([
    getOwnerRezProperties(actor),
    getOwnerRezHighlights(actor, 20),
  ]);

  return (
    <div>
      <PageHeader
        title="OwnerRez"
        subtitle="Live read-only view of OwnerRez's property portfolio and upcoming bookings — OwnerRez remains the source of truth."
      />
      <OwnerRezOverview properties={properties} bookings={bookings} />
    </div>
  );
}
