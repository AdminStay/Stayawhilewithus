import { PageHeader } from "@stayw/ui";

import { AuditLogList } from "@/domains/audit/components/AuditLogList";
import { WorkflowExecutionList } from "@/domains/audit/components/WorkflowExecutionList";
import {
  listAuditLogs,
  listWorkflowExecutions,
} from "@/domains/audit/services/audit.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function AuditPage() {
  const actor = await getCurrentUser();
  const [logs, executions] = await Promise.all([
    listAuditLogs(actor),
    listWorkflowExecutions(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Audit"
        subtitle="A record of who did what, and when."
      />
      <AuditLogList logs={logs} />
      <WorkflowExecutionList executions={executions} />
    </div>
  );
}
