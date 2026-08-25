import {
  Badge,
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Link2 } from "lucide-react";

import type { OwnerRezMatchReport } from "../services/ownerrez-match-report.service";

function OwnerRezStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? "success" : "neutral"}>
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}

/**
 * Read-only Production preview of the OwnerRez match report — strictly a
 * display component. Deliberately never imports a ConfirmButton,
 * DialogTrigger, form action, or any write-capable module: this file has
 * no field-change/preview data, no confirm/create/apply UI, and no way to
 * reach one. Renders exactly what matchOwnerRezProperties() returns —
 * nothing more.
 */
export function OwnerRezMatchReportPreview({
  report,
}: {
  report: OwnerRezMatchReport;
}) {
  const {
    alreadyLinked,
    proposedMatches,
    unmatchedOwnerRez,
    unmatchedStayWhile,
  } = report;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Proposed matches ({proposedMatches.length})
        </h2>
        {proposedMatches.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No proposed matches"
            description="No unlinked StayWhile property shares an internal code with an unlinked OwnerRez property right now."
          />
        ) : (
          <Table>
            <TableHead>
              <TableHeaderCell>StayWhile property</TableHeaderCell>
              <TableHeaderCell>Internal code</TableHeaderCell>
              <TableHeaderCell>OwnerRez property</TableHeaderCell>
              <TableHeaderCell>OwnerRez internal code</TableHeaderCell>
              <TableHeaderCell>OwnerRez status</TableHeaderCell>
            </TableHead>
            <TableBody>
              {proposedMatches.map(({ property, ownerRezProperty }) => (
                <TableRow key={`${property.id}-${ownerRezProperty.id}`}>
                  <TableCell className="font-medium text-ink">
                    {property.name}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {property.internalCode}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {ownerRezProperty.name}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {ownerRezProperty.internal_code ?? "—"}
                  </TableCell>
                  <TableCell>
                    <OwnerRezStatusBadge active={ownerRezProperty.active} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Already linked ({alreadyLinked.length})
        </h2>
        {alreadyLinked.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No StayWhile property is linked to an OwnerRez property yet.
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableHeaderCell>StayWhile property</TableHeaderCell>
              <TableHeaderCell>OwnerRez property</TableHeaderCell>
              <TableHeaderCell>OwnerRez status</TableHeaderCell>
            </TableHead>
            <TableBody>
              {alreadyLinked.map(({ property, ownerRezProperty }) => (
                <TableRow key={property.id}>
                  <TableCell className="font-medium text-ink">
                    {property.name}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {ownerRezProperty.name}
                  </TableCell>
                  <TableCell>
                    <OwnerRezStatusBadge active={ownerRezProperty.active} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-display text-sm font-semibold text-ink">
            Unmatched in OwnerRez ({unmatchedOwnerRez.length})
          </h2>
          <p className="mb-3 text-xs text-ink-faint">
            No StayWhile property shares an internal code with these. Preview
            only — creating or linking a property is not available on this page.
          </p>
          {unmatchedOwnerRez.length === 0 ? (
            <p className="text-sm text-ink-muted">None.</p>
          ) : (
            <ul className="space-y-2 text-sm text-ink-muted">
              {unmatchedOwnerRez.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span>
                    {p.name}
                    {p.internal_code ? ` (${p.internal_code})` : ""}
                  </span>
                  <OwnerRezStatusBadge active={p.active} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-display text-sm font-semibold text-ink">
            Unmatched StayWhile properties ({unmatchedStayWhile.length})
          </h2>
          <p className="mb-3 text-xs text-ink-faint">
            No OwnerRez property shares an internal code with these.
          </p>
          {unmatchedStayWhile.length === 0 ? (
            <p className="text-sm text-ink-muted">None.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-muted">
              {unmatchedStayWhile.map((p) => (
                <li key={p.id}>
                  {p.name} ({p.internalCode})
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
