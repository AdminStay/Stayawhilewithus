import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type Tone,
} from "@stayw/ui";
import { Sparkles } from "lucide-react";

import {
  cancelCleaningScheduleAction,
  completeCleaningScheduleAction,
  markCleaningScheduleMissedAction,
  rescheduleCleaningScheduleAction,
} from "../actions";
import type { CleaningSchedule } from "../services/cleaning.service";

import { CleaningCleanerCell } from "./CleaningCleanerCell";
import type {
  CleanerOption,
  CleaningAction,
  PropertyCleaners,
} from "./cleaner-options";

type ScheduleWithRelations = CleaningSchedule & {
  property: { name: string };
  reservation: { id: string } | null;
  cleaner: { id: string; name: string; status: string } | null;
};

/**
 * Cleaner Phase 4 inputs. Omitted (or `canSeeCleaners: false`) for viewers
 * without cleaners:read — the Cleaner column is then hidden entirely, the
 * same rule as the Cleaner column on /properties.
 */
export interface CleaningCleanerProps {
  canSeeCleaners: boolean;
  /** Admin only — shows the per-job cleaner picker on open jobs. */
  canChangeCleaner: boolean;
  propertyCleaners: Record<string, PropertyCleaners>;
  activeCleaners: CleanerOption[];
  assignCleanerAction: CleaningAction;
}

/**
 * Matches the server's CLEANER_LOCKED_STATUSES: a completed, cancelled or
 * missed job's cleaner is fixed. Kept as a local copy so this component
 * imports only types from the service module.
 */
const CLEANER_LOCKED = new Set(["COMPLETED", "CANCELLED", "MISSED"]);

const STATUS_TONE: Record<string, Tone> = {
  SCHEDULED: "info",
  COMPLETED: "success",
  CANCELLED: "error",
  MISSED: "warning",
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString();
}

export function CleaningScheduleList({
  schedules,
  cleaners,
}: {
  schedules: ScheduleWithRelations[];
  cleaners?: CleaningCleanerProps;
}) {
  const showCleaner = cleaners?.canSeeCleaners === true;
  if (schedules.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={Sparkles}
          title="No cleaning schedules yet"
          description="Schedule your first cleaning to get started."
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Property</TableHeaderCell>
        {showCleaner && <TableHeaderCell>Cleaner</TableHeaderCell>}
        <TableHeaderCell>Scheduled</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell className="text-right">Actions</TableHeaderCell>
      </TableHead>
      <TableBody>
        {schedules.map((s) => {
          const isOpen =
            s.status !== "COMPLETED" &&
            s.status !== "CANCELLED" &&
            s.status !== "MISSED";
          return (
            <TableRow key={s.id}>
              <TableCell>
                <span className="font-medium text-ink">{s.property.name}</span>
                <div className="text-xs text-ink-muted">{s.cleaningType}</div>
              </TableCell>
              {showCleaner && cleaners && (
                <TableCell>
                  <CleaningCleanerCell
                    scheduleId={s.id}
                    propertyName={s.property.name}
                    cleaner={s.cleaner}
                    propertyCleaners={cleaners.propertyCleaners[s.propertyId]}
                    activeCleaners={cleaners.activeCleaners}
                    canChange={
                      cleaners.canChangeCleaner && !CLEANER_LOCKED.has(s.status)
                    }
                    action={cleaners.assignCleanerAction}
                  />
                </TableCell>
              )}
              <TableCell className="text-ink-muted">
                {formatDate(s.scheduledDate)}
                {s.scheduledStartTime && ` · ${s.scheduledStartTime}`}
                {s.scheduledEndTime && `–${s.scheduledEndTime}`}
                {s.originalScheduledDate && (
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge tone="gold">Rescheduled</Badge>
                    <span className="text-xs">
                      was {formatDate(s.originalScheduledDate)}
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                <StatusIndicator
                  label={s.status}
                  tone={STATUS_TONE[s.status] ?? "neutral"}
                />
              </TableCell>
              <TableCell>
                {isOpen && (
                  <div className="flex items-center justify-end gap-2">
                    <form
                      action={rescheduleCleaningScheduleAction}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="scheduleId" value={s.id} />
                      <Input
                        name="scheduledDate"
                        type="date"
                        defaultValue={new Date(s.scheduledDate)
                          .toISOString()
                          .slice(0, 10)}
                        required
                        className="py-1.5 text-xs"
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Reschedule
                      </Button>
                    </form>
                    <form action={completeCleaningScheduleAction}>
                      <input type="hidden" name="scheduleId" value={s.id} />
                      <Button type="submit" variant="primary" size="sm">
                        Complete
                      </Button>
                    </form>
                    <form action={markCleaningScheduleMissedAction}>
                      <input type="hidden" name="scheduleId" value={s.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Missed
                      </Button>
                    </form>
                    <form action={cancelCleaningScheduleAction}>
                      <input type="hidden" name="scheduleId" value={s.id} />
                      <Button type="submit" variant="danger" size="sm">
                        Cancel
                      </Button>
                    </form>
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
