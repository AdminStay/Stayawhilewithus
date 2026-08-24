import {
  Badge,
  Card,
  ConfirmButton,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Link2 } from "lucide-react";

import { confirmOwnerRezPropertyMatchAction } from "../actions";
import type { OwnerRezMatchReport } from "../services/ownerrez-sync.service";

/**
 * Pure display + one write action (confirm) — matches the exact shape
 * matchOwnerRezProperties() returns. Every row here is either already
 * linked (read-only) or a proposed match awaiting explicit human
 * confirmation; nothing renders as linked until an admin clicks Confirm.
 */
export function OwnerRezMatchReview({
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
              <TableHeaderCell>Actions</TableHeaderCell>
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
                    <form action={confirmOwnerRezPropertyMatchAction}>
                      <input
                        type="hidden"
                        name="propertyId"
                        value={property.id}
                      />
                      <input
                        type="hidden"
                        name="ownerRezPropertyId"
                        value={String(ownerRezProperty.id)}
                      />
                      <ConfirmButton
                        type="submit"
                        size="sm"
                        variant="primary"
                        confirmMessage={`Link "${property.name}" to OwnerRez property "${ownerRezProperty.name}"? This is permanent unless unlinked later — StayWhile will start treating OwnerRez as the source of truth for this property's synced fields.`}
                      >
                        Confirm match
                      </ConfirmButton>
                    </form>
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
                    <Badge
                      tone={ownerRezProperty.active ? "success" : "neutral"}
                    >
                      {ownerRezProperty.active ? "Active" : "Inactive"}
                    </Badge>
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
            No StayWhile property shares an internal code with these — never
            auto-created. Add or edit a StayWhile property&apos;s internal code
            to make one of these proposable.
          </p>
          {unmatchedOwnerRez.length === 0 ? (
            <p className="text-sm text-ink-muted">None.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-muted">
              {unmatchedOwnerRez.map((p) => (
                <li key={p.id}>
                  {p.name}
                  {p.internal_code ? ` (${p.internal_code})` : ""}
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
