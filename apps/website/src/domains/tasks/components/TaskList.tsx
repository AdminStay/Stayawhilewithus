import {
  Badge,
  Button,
  Card,
  EmptyState,
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
import { ListChecks } from "lucide-react";

import { assignTaskAction, completeTaskAction } from "../actions";

import type { Task } from "../services/tasks.service";

type TaskWithRelations = Task & {
  property: { name: string } | null;
  assignedTo: { firstName: string | null; lastName: string | null } | null;
};

type AssignableUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

const STATUS_TONE: Record<string, Tone> = {
  TODO: "neutral",
  IN_PROGRESS: "info",
  DONE: "success",
  CANCELLED: "error",
};

const PRIORITY_TONE: Record<string, Tone> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warning",
  URGENT: "error",
};

export function TaskList({
  tasks,
  assignableUsers,
}: {
  tasks: TaskWithRelations[];
  assignableUsers: AssignableUser[];
}) {
  if (tasks.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={ListChecks}
          title="No tasks yet"
          description="Add your first task to get started."
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Task</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell>Assigned to</TableHeaderCell>
        <TableHeaderCell className="text-right">Actions</TableHeaderCell>
      </TableHead>
      <TableBody>
        {tasks.map((t) => {
          const openTask = t.status !== "DONE" && t.status !== "CANCELLED";
          return (
            <TableRow key={t.id}>
              <TableCell>
                <span className="font-medium text-ink">{t.title}</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone="neutral">{t.type}</Badge>
                  <Badge tone={PRIORITY_TONE[t.priority] ?? "neutral"}>
                    {t.priority}
                  </Badge>
                  {t.property && (
                    <span className="text-xs text-ink-muted">
                      {t.property.name}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <StatusIndicator
                  label={t.status}
                  tone={STATUS_TONE[t.status] ?? "neutral"}
                />
              </TableCell>
              <TableCell className="text-ink-muted">
                {t.assignedTo
                  ? `${t.assignedTo.firstName ?? ""} ${t.assignedTo.lastName ?? ""}`.trim()
                  : "Unassigned"}
              </TableCell>
              <TableCell>
                {openTask && (
                  <div className="flex items-center justify-end gap-2">
                    <form
                      action={assignTaskAction}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="taskId" value={t.id} />
                      <Select
                        name="assignedToUserId"
                        defaultValue={t.assignedToUserId ?? ""}
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
                    <form action={completeTaskAction}>
                      <input type="hidden" name="taskId" value={t.id} />
                      <Button type="submit" variant="primary" size="sm">
                        Mark done
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
