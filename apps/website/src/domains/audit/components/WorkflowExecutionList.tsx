import { Badge, Card, EmptyState, SectionHeader } from "@stayw/ui";
import { Workflow } from "lucide-react";

import type { WorkflowExecution } from "../services/audit.service";

function formatDate(date: Date | null): string {
  return date ? new Date(date).toLocaleString() : "—";
}

export function WorkflowExecutionList({
  executions,
}: {
  executions: WorkflowExecution[];
}) {
  return (
    <div className="mt-8">
      <SectionHeader title="Automations (n8n workflow runs)" />
      <Card noPadding>
        {executions.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No workflow runs yet"
            description="Nothing has called triggerWorkflow() since this table was last empty."
          />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {executions.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <span className="text-xs text-ink-faint">
                  [{formatDate(e.startedAt)}]
                </span>{" "}
                <span className="font-medium text-ink">{e.workflowName}</span>{" "}
                <Badge tone={e.status === "FAILED" ? "error" : "neutral"}>
                  {e.status}
                </Badge>{" "}
                <span className="text-ink-faint">via {e.triggerSource}</span>
                {e.errorMessage && (
                  <p className="mt-1 text-xs text-error-500">
                    {e.errorMessage}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
