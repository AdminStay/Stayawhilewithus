import { Badge, Card } from "@stayw/ui";

import { formatAddress } from "../lib/owner-rez-onboarding-display";

import { CopyActiveOwnerRezCsvButton } from "./CopyActiveOwnerRezCsvButton";
import { CreatePropertyFromOwnerRezButton } from "./CreatePropertyFromOwnerRezButton";

import type { OwnerRezOnboardingReport } from "../services/ownerrez-onboarding.service";

/**
 * Read-only Active/Inactive lists of OwnerRez properties with no StayWhile
 * Property row yet, plus a one-at-a-time "Create StayWhile Property"
 * control — the only write affordance in this component, and only for
 * active rows whose detail actually loaded (never offered when `detail` is
 * null, since createPropertyFromOwnerRez() would just reject an incomplete
 * fetch anyway — this avoids a guaranteed-to-fail submission, not a
 * security boundary; the real validation lives server-side).
 *
 * Never creates more than one property per click: each Create button
 * submits exactly one ownerRezPropertyId, and createPropertyFromOwnerRezSchema
 * has no array/bulk shape to accept more even if a request tried. There is
 * no "create all" control anywhere in this component.
 */
export function OwnerRezOnboardingPanel({
  report,
}: {
  report: OwnerRezOnboardingReport;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-base font-semibold text-ink">
        OwnerRez properties not yet in StayWhile
      </h2>
      <p className="mb-4 text-xs text-ink-faint">
        These OwnerRez properties have no linked StayWhile property row.
        Creating one uses OwnerRez&apos;s own record as the authoritative source
        — nothing is inferred from device names. New properties start at
        Onboarding status, never Active.
      </p>

      <div className="mb-2 flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium text-ink">
          Active ({report.active.length})
        </h3>
        <CopyActiveOwnerRezCsvButton active={report.active} />
      </div>
      <div className="mb-6 space-y-3">
        {report.active.length === 0 && (
          <p className="text-xs text-ink-faint">
            No unmatched active OwnerRez properties.
          </p>
        )}
        {report.active.map(({ ownerRezProperty, detail }) => (
          <Card
            key={ownerRezProperty.id}
            className="flex items-center justify-between gap-4"
          >
            <div className="text-sm">
              <div className="font-medium text-ink">
                {ownerRezProperty.name}{" "}
                <span className="text-ink-muted">
                  (ID {ownerRezProperty.id}
                  {ownerRezProperty.internal_code
                    ? `, ${ownerRezProperty.internal_code}`
                    : ""}
                  )
                </span>
              </div>
              <div className="text-ink-muted">{formatAddress(detail)}</div>
            </div>

            {detail ? (
              <CreatePropertyFromOwnerRezButton
                ownerRezPropertyId={ownerRezProperty.id}
                ownerRezPropertyName={ownerRezProperty.name}
                ownerRezTimezone={detail.time_zone}
              />
            ) : (
              <Badge tone="neutral">Detail unavailable</Badge>
            )}
          </Card>
        ))}
      </div>

      <h3 className="mb-2 text-sm font-medium text-ink">
        Inactive ({report.inactive.length})
      </h3>
      <div className="space-y-3">
        {report.inactive.length === 0 && (
          <p className="text-xs text-ink-faint">
            No unmatched inactive OwnerRez properties.
          </p>
        )}
        {report.inactive.map(({ ownerRezProperty }) => (
          <Card
            key={ownerRezProperty.id}
            className="flex items-center justify-between gap-4"
          >
            <div className="text-sm">
              <div className="font-medium text-ink">
                {ownerRezProperty.name}{" "}
                <span className="text-ink-muted">
                  (ID {ownerRezProperty.id}
                  {ownerRezProperty.internal_code
                    ? `, ${ownerRezProperty.internal_code}`
                    : ""}
                  )
                </span>
              </div>
            </div>
            <Badge tone="neutral">Inactive</Badge>
          </Card>
        ))}
      </div>
    </section>
  );
}
