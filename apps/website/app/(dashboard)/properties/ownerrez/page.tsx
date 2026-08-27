import { EmptyState, PageHeader } from "@stayw/ui";
import { PlugZap } from "lucide-react";

import { OwnerRezConfirmLinkPanel } from "@/domains/properties/components/OwnerRezConfirmLinkPanel";
import { OwnerRezMatchReportPreview } from "@/domains/properties/components/OwnerRezMatchReportPreview";
import { OwnerRezOnboardingPanel } from "@/domains/properties/components/OwnerRezOnboardingPanel";
import { matchOwnerRezProperties } from "@/domains/properties/services/ownerrez-match-report.service";
import { enrichUnmatchedOwnerRezProperties } from "@/domains/properties/services/ownerrez-onboarding.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Live OwnerRez <-> StayWhile property match report, plus Phase B's
 * one-at-a-time approved-link confirmation panel, plus the OwnerRez-only
 * property onboarding panel. Calls matchOwnerRezProperties() (read-only —
 * see ownerrez-match-report.service.ts) once; its unmatchedOwnerRez bucket
 * is passed straight into enrichUnmatchedOwnerRezProperties() rather than
 * re-fetching OwnerRez's property list a second time.
 * OwnerRezMatchReportPreview remains exactly the read-only, display-only
 * component it always was — unchanged by any of this. The only write
 * affordances on this page live inside OwnerRezConfirmLinkPanel (approved
 * links only) and OwnerRezOnboardingPanel (one-at-a-time property
 * creation from an OwnerRez record) — this page itself renders neither a
 * ConfirmButton nor a write server action directly.
 */
export default async function OwnerRezMatchReportPage() {
  const actor = await getCurrentUser();
  const result = await matchOwnerRezProperties(actor);

  const onboardingReport = result.configured
    ? await enrichUnmatchedOwnerRezProperties(
        actor,
        result.report.unmatchedOwnerRez,
      )
    : null;

  return (
    <div className="space-y-10">
      <PageHeader
        title="OwnerRez Match Report"
        subtitle="Live match report against OwnerRez's real property list, plus one-at-a-time confirmation for the properties a human has already approved for linking."
      />
      {result.configured && onboardingReport ? (
        <>
          <OwnerRezConfirmLinkPanel report={result.report} />
          <OwnerRezOnboardingPanel report={onboardingReport} />
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
