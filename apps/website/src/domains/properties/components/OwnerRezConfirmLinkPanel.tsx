import { Badge, Card, ConfirmButton } from "@stayw/ui";

import { confirmOwnerRezLinkAction } from "../actions";
import { APPROVED_OWNERREZ_LINKS } from "../config/ownerrez-approved-links";

import type {
  OwnerRezMatchReport,
  StayWhilePropertySummary,
} from "../services/ownerrez-match-report.service";
import type { OwnerrezProperty } from "@stayw/integrations/ownerrez";

function findStayWhileProperty(
  report: OwnerRezMatchReport,
  internalCode: string,
): StayWhilePropertySummary | undefined {
  return (
    report.alreadyLinked.find((m) => m.property.internalCode === internalCode)
      ?.property ??
    report.proposedMatches.find((m) => m.property.internalCode === internalCode)
      ?.property ??
    report.unmatchedStayWhile.find((p) => p.internalCode === internalCode)
  );
}

function findOwnerRezProperty(
  report: OwnerRezMatchReport,
  ownerRezPropertyId: string,
): OwnerrezProperty | undefined {
  const id = Number(ownerRezPropertyId);
  return (
    report.alreadyLinked.find((m) => m.ownerRezProperty.id === id)
      ?.ownerRezProperty ??
    report.proposedMatches.find((m) => m.ownerRezProperty.id === id)
      ?.ownerRezProperty ??
    report.unmatchedOwnerRez.find((p) => p.id === id)
  );
}

/**
 * The only place a Confirm Link control exists anywhere in this domain.
 * Deliberately separate from OwnerRezMatchReportPreview (which stays
 * strictly read-only, unchanged) — this component owns the entire write
 * affordance so that component's own "never imports a ConfirmButton" claim
 * stays literally true.
 *
 * Renders one row per entry in the closed, human-approved
 * APPROVED_OWNERREZ_LINKS allow-list — never per row in the live report's
 * proposedMatches. A property not in that allow-list (e.g. Miramar Bliss)
 * gets no row here at all, regardless of what the live report shows for it.
 * This is a display-time convenience only: the actual authorization lives
 * entirely in ownerrez-link.service.ts's confirmOwnerRezLink(), which
 * re-derives everything server-side and does not trust this component's
 * rendering decisions.
 *
 * A Confirm control only renders when this component can find BOTH sides
 * live in the already-fetched report (so the form has a real StayWhile
 * property id to submit and something real to show the human) and the
 * StayWhile side isn't already linked.
 */
export function OwnerRezConfirmLinkPanel({
  report,
}: {
  report: OwnerRezMatchReport;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-base font-semibold text-ink">
        Approved OwnerRez links
      </h2>
      <p className="mb-4 text-xs text-ink-faint">
        These {APPROVED_OWNERREZ_LINKS.length} pairings have been explicitly
        reviewed and approved by a human, one at a time. Confirming a link sets
        only that property&apos;s OwnerRez id — nothing else changes.
      </p>
      <div className="space-y-3">
        {APPROVED_OWNERREZ_LINKS.map((approved) => {
          const stayWhileProperty = findStayWhileProperty(
            report,
            approved.propertyInternalCode,
          );
          const ownerRezProperty = findOwnerRezProperty(
            report,
            approved.ownerRezPropertyId,
          );
          const isLinked = Boolean(stayWhileProperty?.ownerRezPropertyId);
          const canConfirm =
            !isLinked &&
            stayWhileProperty !== undefined &&
            ownerRezProperty !== undefined;

          return (
            <Card
              key={approved.propertyInternalCode}
              className="flex items-center justify-between gap-4"
            >
              <div className="text-sm">
                <div className="font-medium text-ink">
                  {stayWhileProperty?.name ?? approved.propertyInternalCode}{" "}
                  <span className="text-ink-muted">
                    ({approved.propertyInternalCode})
                  </span>
                </div>
                <div className="text-ink-muted">
                  → OwnerRez:{" "}
                  {ownerRezProperty?.name ?? approved.ownerRezPropertyName} (ID{" "}
                  {approved.ownerRezPropertyId})
                  {ownerRezProperty ? (
                    <Badge
                      tone={ownerRezProperty.active ? "success" : "neutral"}
                      className="ml-2"
                    >
                      {ownerRezProperty.active ? "Active" : "Inactive"}
                    </Badge>
                  ) : null}
                </div>
              </div>

              {isLinked ? (
                <Badge tone="success">Linked</Badge>
              ) : canConfirm && stayWhileProperty ? (
                <form action={confirmOwnerRezLinkAction}>
                  <input
                    type="hidden"
                    name="propertyId"
                    value={stayWhileProperty.id}
                  />
                  <input
                    type="hidden"
                    name="ownerRezPropertyId"
                    value={approved.ownerRezPropertyId}
                  />
                  <ConfirmButton
                    type="submit"
                    variant="primary"
                    size="sm"
                    confirmMessage={`Link StayWhile property "${stayWhileProperty.name}" (${approved.propertyInternalCode}) to OwnerRez property "${ownerRezProperty?.name ?? approved.ownerRezPropertyName}" (ID ${approved.ownerRezPropertyId}, ${ownerRezProperty?.active ? "Active" : "Inactive"})? This cannot be undone from this page.`}
                  >
                    Confirm Link
                  </ConfirmButton>
                </form>
              ) : (
                <Badge tone="neutral">Not available</Badge>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
