import { EmptyState, PageHeader } from "@stayw/ui";
import { PlugZap } from "lucide-react";

import { OwnerRezConfirmLinkPanel } from "@/domains/properties/components/OwnerRezConfirmLinkPanel";
import { OwnerRezMatchReportPreview } from "@/domains/properties/components/OwnerRezMatchReportPreview";
import { matchOwnerRezProperties } from "@/domains/properties/services/ownerrez-match-report.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Live OwnerRez <-> StayWhile property match report, plus Phase B's
 * one-at-a-time approved-link confirmation panel. Calls only
 * matchOwnerRezProperties() (read-only — see ownerrez-match-report.service.ts)
 * once, and passes the same result to both sections below.
 * OwnerRezMatchReportPreview remains exactly the read-only, display-only
 * component it always was — unchanged by Phase B. The only write affordance
 * on this page lives in OwnerRezConfirmLinkPanel, which renders a Confirm
 * control solely for the closed, human-approved set in
 * APPROVED_OWNERREZ_LINKS.
 */
export default async function OwnerRezMatchReportPage() {
  const actor = await getCurrentUser();
  const result = await matchOwnerRezProperties(actor);

  return (
    <div className="space-y-10">
      <PageHeader
        title="OwnerRez Match Report"
        subtitle="Live match report against OwnerRez's real property list, plus one-at-a-time confirmation for the properties a human has already approved for linking."
      />
      {result.configured ? (
        <>
          <OwnerRezConfirmLinkPanel report={result.report} />
          <OwnerRezMatchReportPreview report={result.report} />
        </>
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
