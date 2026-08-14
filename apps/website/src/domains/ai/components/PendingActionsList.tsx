import { Badge, Button, EmptyState, Input, SectionHeader } from "@stayw/ui";
import { Bot } from "lucide-react";

import { approveAiActionAction, rejectAiActionAction } from "../actions";

import type { AiAction } from "../services/ai.service";

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

export function PendingActionsList({ actions }: { actions: AiAction[] }) {
  return (
    <div className="mt-10">
      <SectionHeader
        title="Pending AI Actions"
        size="lg"
        description={
          actions.length > 0
            ? `${actions.length} action${actions.length === 1 ? "" : "s"} awaiting approval`
            : undefined
        }
      />
      {actions.length === 0 ? (
        <EmptyState icon={Bot} title="No actions awaiting approval" />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {actions.map((a) => (
            <li key={a.id} className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{a.toolName}</span>
                    <Badge tone="gold">{a.riskLevel}</Badge>
                    <span className="text-xs text-ink-muted">
                      {formatDate(a.createdAt)}
                    </span>
                  </div>
                  {a.reasoning && (
                    <p className="mt-1 text-sm text-ink-muted">{a.reasoning}</p>
                  )}
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-muted p-2.5 text-xs text-ink-muted">
                    {JSON.stringify(a.proposedInput, null, 2)}
                  </pre>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <form action={approveAiActionAction}>
                    <input type="hidden" name="actionId" value={a.id} />
                    <Button type="submit" variant="primary" size="sm">
                      Approve
                    </Button>
                  </form>
                  <form
                    action={rejectAiActionAction}
                    className="flex items-center gap-1.5"
                  >
                    <input type="hidden" name="actionId" value={a.id} />
                    <Input
                      name="rejectionReason"
                      required
                      placeholder="Reason"
                      className="w-28 py-1.5 text-xs"
                    />
                    <Button type="submit" variant="danger" size="sm">
                      Reject
                    </Button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
