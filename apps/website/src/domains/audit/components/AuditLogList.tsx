import { Card, EmptyState } from "@stayw/ui";
import { ShieldCheck } from "lucide-react";

import type { AuditLog } from "../services/audit.service";

type LogWithActor = AuditLog & {
  actorUser: { firstName: string | null; lastName: string | null } | null;
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

export function AuditLogList({ logs }: { logs: LogWithActor[] }) {
  if (logs.length === 0) {
    return (
      <Card noPadding>
        <EmptyState icon={ShieldCheck} title="No audit entries yet" />
      </Card>
    );
  }

  return (
    <Card noPadding>
      <ul className="divide-y divide-border text-sm">
        {logs.map((log) => (
          <li key={log.id} className="px-5 py-3">
            <span className="text-xs text-ink-faint">
              [{formatDate(log.occurredAt)}]
            </span>{" "}
            <span className="font-medium text-ink">{log.action}</span>{" "}
            <span className="text-ink-muted">
              {log.entityType} {log.entityId}
            </span>{" "}
            <span className="text-ink-faint">
              by{" "}
              {log.actorType === "USER"
                ? `${log.actorUser?.firstName ?? ""} ${log.actorUser?.lastName ?? ""}`.trim() ||
                  "a user"
                : log.actorType}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
