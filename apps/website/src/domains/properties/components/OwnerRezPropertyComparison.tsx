import {
  Badge,
  Card,
  SectionHeader,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type Tone,
} from "@stayw/ui";

import {
  COMPARISON_STATUS_LABEL,
  COMPARISON_STATUSES,
  OWNERREZ_UNAVAILABLE_REASON_LABEL,
  type ComparisonStatus,
  type OwnerRezPropertyComparisonRow,
} from "../lib/ownerrez-property-comparison";
import {
  PROPERTY_STATUS_TONE,
  propertyStatusLabel,
} from "../lib/property-status-filter";

import { OwnerRezLink } from "@/domains/integrations/components/OwnerRezLink";
import { ownerRezPropertyUrl } from "@/domains/integrations/lib/ownerrez-links";

const STATUS_TONE: Record<ComparisonStatus, Tone> = {
  match: "success",
  formatting_only: "info",
  differs: "warning",
  missing_in_ownerrez: "neutral",
  missing_in_staywhile: "warning",
  ownerrez_unavailable: "error",
};

/** Always a text label, never colour alone. */
function StatusBadge({ status }: { status: ComparisonStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>{COMPARISON_STATUS_LABEL[status]}</Badge>
  );
}

function Value({ value }: { value: string | null }) {
  return value === null ? (
    <span className="text-ink-faint">(empty)</span>
  ) : (
    <span>{value}</span>
  );
}

/**
 * Read-only OwnerRez-versus-StayWhile property comparison (2026-10-16).
 * Display only: no form, button or server action — differences are shown
 * for a human to review, never applied. "Missing in OwnerRez" means
 * StayWhile keeps its value.
 */
export function OwnerRezPropertyComparison({
  rows,
  rateLimited,
}: {
  rows: OwnerRezPropertyComparisonRow[];
  rateLimited: boolean;
}) {
  const totals = Object.fromEntries(
    COMPARISON_STATUSES.map((s) => [
      s,
      rows.reduce((sum, r) => sum + r.counts[s], 0),
    ]),
  ) as Record<ComparisonStatus, number>;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={`${rows.length} linked ${rows.length === 1 ? "property" : "properties"}`}
        description="Read-only. Nothing on this page changes StayWhile or OwnerRez. “Missing in OwnerRez” means OwnerRez has no value — StayWhile keeps its own."
        size="lg"
      />

      {rateLimited && (
        <p role="status" className="text-sm text-warning-600">
          OwnerRez&apos;s request limit was reached during this comparison.
          Properties not yet read show “OwnerRez data unavailable”. Reload in a
          few minutes to try again.
        </p>
      )}

      <ul aria-label="Comparison totals" className="flex flex-wrap gap-2">
        {COMPARISON_STATUSES.map((s) => (
          <li key={s}>
            <Badge tone={STATUS_TONE[s]}>
              {COMPARISON_STATUS_LABEL[s]}: {totals[s]}
            </Badge>
          </li>
        ))}
      </ul>

      {rows.map((row) => {
        const ownerRezUrl = ownerRezPropertyUrl(
          row.property.ownerRezPropertyId,
        );
        return (
          <section
            key={row.property.id}
            aria-label={`${row.property.name} comparison`}
          >
            <Card noPadding>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="font-medium text-ink">
                  {row.property.name}
                </span>
                <span className="text-xs text-ink-muted">
                  {row.property.internalCode}
                </span>
                <StatusIndicator
                  label={propertyStatusLabel(row.property.status)}
                  tone={PROPERTY_STATUS_TONE[row.property.status] ?? "neutral"}
                />
                <span className="text-xs text-ink-muted">
                  OwnerRez #{row.property.ownerRezPropertyId}
                  {row.ownerRezName ? ` — ${row.ownerRezName}` : ""}
                  {ownerRezUrl && (
                    <OwnerRezLink
                      href={ownerRezUrl}
                      label="Open in OwnerRez"
                      title={`Open ${row.property.name} in OwnerRez`}
                    />
                  )}
                </span>
              </div>
              {row.unavailableReason && (
                <p className="px-4 pb-2 text-xs text-error-600">
                  {OWNERREZ_UNAVAILABLE_REASON_LABEL[row.unavailableReason]}
                </p>
              )}
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Field</TableHeaderCell>
                    <TableHeaderCell>StayWhile</TableHeaderCell>
                    <TableHeaderCell>OwnerRez</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {row.fields.map((f) => (
                    <TableRow key={f.field}>
                      <TableCell className="text-ink-muted">
                        {f.label}
                      </TableCell>
                      <TableCell>
                        <Value value={f.stayWhile} />
                      </TableCell>
                      <TableCell>
                        {f.status === "ownerrez_unavailable" ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <Value value={f.ownerRez} />
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={f.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
