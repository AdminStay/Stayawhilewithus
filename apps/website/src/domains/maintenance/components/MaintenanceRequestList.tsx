import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type Tone,
} from "@stayw/ui";
import { Wrench } from "lucide-react";

import {
  assignMaintenanceRequestAction,
  resolveMaintenanceRequestAction,
} from "../actions";

import type { MaintenanceRequest } from "../services/maintenance.service";

type RequestWithRelations = MaintenanceRequest & {
  property: { name: string };
  task: { status: string; assignedToUserId: string | null } | null;
};

type AssignableUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "warning",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

const SEVERITY_TONE: Record<string, Tone> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  EMERGENCY: "error",
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

export function MaintenanceRequestList({
  requests,
  assignableUsers,
}: {
  requests: RequestWithRelations[];
  assignableUsers: AssignableUser[];
}) {
  if (requests.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={Wrench}
          title="No maintenance requests"
          description="Reported issues will show up here."
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Issue</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell className="text-right">Actions</TableHeaderCell>
      </TableHead>
      <TableBody>
        {requests.map((r) => {
          const isOpen = r.status !== "RESOLVED" && r.status !== "CANCELLED";
          return (
            <TableRow key={r.id}>
              <TableCell>
                <span className="font-medium text-ink">{r.property.name}</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone="neutral">{r.category}</Badge>
                  <Badge tone={SEVERITY_TONE[r.severity] ?? "neutral"}>
                    {r.severity}
                  </Badge>
                  <span className="text-xs text-ink-muted">
                    {formatDate(r.reportedAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink-muted">{r.description}</p>
                {r.resolutionNotes && (
                  <p className="mt-1 text-sm text-ink-faint">
                    Resolution: {r.resolutionNotes}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <StatusIndicator
                  label={r.status}
                  tone={STATUS_TONE[r.status] ?? "neutral"}
                />
              </TableCell>
              <TableCell>
                {isOpen && (
                  <div className="flex flex-col items-end gap-2">
                    <form
                      action={assignMaintenanceRequestAction}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="requestId" value={r.id} />
                      <Select
                        name="assignedToUserId"
                        defaultValue={r.task?.assignedToUserId ?? ""}
                        className="py-1.5 text-xs"
                      >
                        <option value="">Unassigned</option>
                        {assignableUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.firstName ?? u.email} {u.lastName ?? ""}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="secondary" size="sm">
                        Assign
                      </Button>
                    </form>
                    <form
                      action={resolveMaintenanceRequestAction}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="requestId" value={r.id} />
                      <Input
                        name="resolutionNotes"
                        placeholder="Resolution notes"
                        className="w-40 py-1.5 text-xs"
                      />
                      <Button type="submit" variant="primary" size="sm">
                        Resolve
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
