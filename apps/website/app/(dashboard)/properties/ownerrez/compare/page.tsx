import { EmptyState, PageHeader } from "@stayw/ui";
import { Building2, PlugZap } from "lucide-react";

import { OwnerRezPropertyComparison } from "@/domains/properties/components/OwnerRezPropertyComparison";
import { compareLinkedOwnerRezProperties } from "@/domains/properties/services/ownerrez-property-comparison.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Read-only OwnerRez-versus-StayWhile property comparison (2026-10-16).
 * Gated by `properties:read` inside compareLinkedOwnerRezProperties(). The
 * page renders no form, button or server action: it only reads StayWhile's
 * linked properties and OwnerRez's property detail, and shows how they
 * compare. It is not a property sync.
 */
export default async function OwnerRezPropertyComparePage() {
  const actor = await getCurrentUser();
  const result = await compareLinkedOwnerRezProperties(actor);

  return (
    <div className="space-y-10">
      <PageHeader
        title="OwnerRez Property Comparison"
        subtitle="StayWhile's stored address, bedrooms, bathrooms, maximum guests and timezone for each property linked to OwnerRez, next to OwnerRez's own values."
      />
      {!result.configured ? (
        <EmptyState
          icon={PlugZap}
          title="OwnerRez isn't configured"
          description="Set OWNERREZ_USERNAME and OWNERREZ_API_TOKEN to enable the property comparison."
        />
      ) : result.rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No linked properties"
          description="No StayWhile property is linked to an OwnerRez property yet."
        />
      ) : (
        <OwnerRezPropertyComparison
          rows={result.rows}
          rateLimited={result.rateLimited}
        />
      )}
    </div>
  );
}
