import { EmptyState, PageHeader } from "@stayw/ui";
import { PlugZap } from "lucide-react";

import { OwnerRezMatchReportPreview } from "@/domains/properties/components/OwnerRezMatchReportPreview";
import { matchOwnerRezProperties } from "@/domains/properties/services/ownerrez-match-report.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Read-only Production preview of the OwnerRez <-> StayWhile property match
 * report. Calls only matchOwnerRezProperties() (a read-only function — see
 * ownerrez-match-report.service.ts) and renders only
 * OwnerRezMatchReportPreview, a display-only component. There is no
 * field-change preview, no confirm/create/apply UI, and no server action
 * reachable from this page — that capability is a separate, not-yet-
 * approved phase.
 */
export default async function OwnerRezMatchReportPage() {
  const actor = await getCurrentUser();
  const result = await matchOwnerRezProperties(actor);

  return (
    <div>
      <PageHeader
        title="OwnerRez Match Report — Read-Only Preview"
        subtitle="Live, read-only match report against OwnerRez's real property list. Nothing on this page links, creates, or overwrites anything."
      />
      {result.configured ? (
        <OwnerRezMatchReportPreview report={result.report} />
      ) : (
        <EmptyState
          icon={PlugZap}
          title="OwnerRez isn't configured"
          description="Set OWNERREZ_USERNAME and OWNERREZ_API_TOKEN to enable the live property match report."
        />
      )}
    </div>
  );
}
