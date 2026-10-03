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
import { Building2 } from "lucide-react";

import type {
  AssignmentView,
  PropertyCleanerRow,
} from "../services/cleaner-assignments.service";

import { AssignCleanerForm } from "./AssignCleanerForm";
import { CleanerActionButton } from "./CleanerActionButton";
import type { CleanerAction } from "./types";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function CurrentCleaner({
  assignment,
  propertyName,
  canManage,
  assignAction,
  endAction,
  propertyId,
  assignable,
}: {
  assignment: AssignmentView;
  propertyName: string;
  canManage: boolean;
  assignable: boolean;
  assignAction: CleanerAction;
  endAction: CleanerAction;
  propertyId: string;
}) {
  const isPrimary = assignment.role === "PRIMARY";
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-ink">{assignment.cleaner.name}</span>
      <span className="text-xs text-ink-muted">
        {assignment.cleaner.phoneDisplay}
      </span>
      {assignment.cleaner.status === "INACTIVE" && (
        <Badge tone="warning">Inactive</Badge>
      )}
      {canManage && (
        <span className="ml-auto inline-flex items-start gap-1.5">
          {!isPrimary && assignable && (
            <CleanerActionButton
              action={assignAction}
              fields={{
                propertyId,
                cleanerId: assignment.cleaner.id,
                role: "PRIMARY",
              }}
              label="Make primary"
              confirmMessage={`Make ${assignment.cleaner.name} the primary cleaner for ${propertyName}? Any current primary is ended and kept in history.`}
            />
          )}
          <CleanerActionButton
            action={endAction}
            fields={{ assignmentId: assignment.id }}
            label="Remove"
            variant="danger"
            confirmMessage={`Remove ${assignment.cleaner.name} (${isPrimary ? "primary" : "team member"}) from ${propertyName}? The assignment is kept in history.`}
          />
        </span>
      )}
    </li>
  );
}

function History({ history }: { history: AssignmentView[] }) {
  if (history.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-ink-muted">
      <summary className="cursor-pointer">History ({history.length})</summary>
      <ul className="mt-1 space-y-0.5">
        {history.map((h) => (
          <li key={h.id}>
            {h.cleaner.name} — {h.role === "PRIMARY" ? "primary" : "team"},{" "}
            {DATE_FORMAT.format(h.startedAt)} → {DATE_FORMAT.format(h.endedAt!)}
            {h.endedByName ? ` (ended by ${h.endedByName})` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

function propertyStatusLabel(row: PropertyCleanerRow): string {
  if (row.property.deleted) return "Removed property";
  return row.property.status === "OFFBOARDED"
    ? "Offboarded property"
    : "Inactive property";
}

/**
 * One row per operational property (ACTIVE / ONBOARDING) with its current
 * primary cleaner, team members and history. A team with no primary is
 * shown as such — never filled in automatically. Rows for an Inactive /
 * Offboarded / removed property that still has cleaners (assignable:
 * false) come last and offer only Remove.
 */
export function PropertyCleanerAssignments({
  rows,
  activeCleaners,
  canManage,
  assignAction,
  endAction,
}: {
  rows: PropertyCleanerRow[];
  activeCleaners: Array<{ id: string; name: string }>;
  canManage: boolean;
  assignAction: CleanerAction;
  endAction: CleanerAction;
}) {
  if (rows.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={Building2}
          title="No active or onboarding properties"
          description="Cleaners can be assigned to Active or Onboarding properties."
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Property</TableHeaderCell>
        <TableHeaderCell>Primary cleaner</TableHeaderCell>
        <TableHeaderCell>Team</TableHeaderCell>
        {canManage && (
          <TableHeaderCell className="text-right">Assign</TableHeaderCell>
        )}
      </TableHead>
      <TableBody>
        {rows.map((row) => {
          const assignedIds = new Set(
            [row.primary, ...row.teamMembers]
              .filter((a): a is AssignmentView => a !== null)
              .map((a) => a.cleaner.id),
          );
          const shared = {
            propertyName: row.property.name,
            propertyId: row.property.id,
            canManage,
            assignAction,
            endAction,
            assignable: row.assignable,
          };
          return (
            <TableRow key={row.property.id}>
              <TableCell className="align-top">
                <span
                  id={`property-${row.property.id}`}
                  className="font-medium text-ink"
                >
                  {row.property.name}
                </span>
                {!row.assignable && (
                  <div className="mt-1">
                    <Badge tone="warning">{propertyStatusLabel(row)}</Badge>
                    <p className="mt-1 text-xs text-ink-muted">
                      No longer takes cleaner assignments — remove the cleaners
                      still listed here.
                    </p>
                  </div>
                )}
                <History history={row.history} />
              </TableCell>
              <TableCell className="align-top">
                {row.primary ? (
                  <ul>
                    <CurrentCleaner assignment={row.primary} {...shared} />
                  </ul>
                ) : row.teamMembers.length > 0 ? (
                  <Badge tone="warning">Primary not set</Badge>
                ) : (
                  <Badge tone="neutral">No cleaner</Badge>
                )}
              </TableCell>
              <TableCell className="align-top">
                {row.teamMembers.length === 0 ? (
                  <span className="text-ink-faint">—</span>
                ) : (
                  <ul className="space-y-1">
                    {row.teamMembers.map((a) => (
                      <CurrentCleaner key={a.id} assignment={a} {...shared} />
                    ))}
                  </ul>
                )}
              </TableCell>
              {canManage && (
                <TableCell className="align-top">
                  {row.assignable ? (
                    <AssignCleanerForm
                      propertyId={row.property.id}
                      propertyName={row.property.name}
                      hasPrimary={row.primary !== null}
                      cleaners={activeCleaners.filter(
                        (c) => !assignedIds.has(c.id),
                      )}
                      action={assignAction}
                    />
                  ) : (
                    <span className="text-xs text-ink-faint">—</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
