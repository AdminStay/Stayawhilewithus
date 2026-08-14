import { Badge, SectionHeader, type Tone } from "@stayw/ui";

import type { AiAction } from "../services/ai.service";

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

const STATUS_TONE: Record<string, Tone> = {
  EXECUTED: "success",
  EXECUTION_FAILED: "error",
  REJECTED: "neutral",
};

/**
 * The other half of the approval UX: PendingActionsList only ever shows
 * actions still awaiting a decision — once approved-and-executed,
 * approved-but-failed, or rejected, an action just disappears from that
 * list with nothing else confirming what happened. This renders the last
 * few resolved actions with their real outcome (including the execution
 * error, if it failed) so approving something has visible closure right on
 * this page, not just in the conversation thread or the audit log.
 */
export function RecentActionsList({ actions }: { actions: AiAction[] }) {
  if (actions.length === 0) return null;

  return (
    <div className="mt-10">
      <SectionHeader title="Recent Action Outcomes" />
      <ul className="divide-y divide-border border-t border-border">
        {actions.map((a) => (
          <li key={a.id} className="py-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">{a.toolName}</span>
              <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>
                {a.status}
              </Badge>
              <span className="text-xs text-ink-muted">
                {formatDate(a.updatedAt)}
              </span>
            </div>
            {a.status === "EXECUTION_FAILED" && a.executionError && (
              <p className="mt-1.5 text-sm text-error-500">
                {a.executionError}
              </p>
            )}
            {a.status === "REJECTED" && a.rejectionReason && (
              <p className="mt-1.5 text-sm text-ink-muted">
                {a.rejectionReason}
              </p>
            )}
            {a.status === "EXECUTED" && a.executionResult != null && (
              <pre className="mt-1.5 overflow-x-auto rounded-lg bg-surface-muted p-2.5 text-xs text-ink-muted">
                {JSON.stringify(a.executionResult, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
