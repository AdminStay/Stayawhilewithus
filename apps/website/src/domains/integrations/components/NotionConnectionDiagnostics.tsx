import { SectionHeader } from "@stayw/ui";

import type { NotionIntegrationIdentityResult } from "../services/integrations.service";

/**
 * "Which Notion integration is THIS environment's NOTION_API_KEY?" —
 * answered from the running app without ever revealing the credential
 * (moved out of the /notion page 2026-10-16 so it can sit, visually
 * secondary, below the search and browsing tabs). Shows only the
 * integration's name, bot id and workspace name; never the key.
 */
export function NotionConnectionDiagnostics({
  identityResult,
}: {
  identityResult: NotionIntegrationIdentityResult;
}) {
  return (
    <div>
      <SectionHeader title="Connection diagnostics" />
      {identityResult.configured && identityResult.ok ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-muted">Integration name</dt>
          <dd className="text-ink">
            {identityResult.identity.botName ?? "(not exposed)"}
          </dd>
          <dt className="text-ink-muted">Bot ID</dt>
          <dd className="text-ink">{identityResult.identity.botId}</dd>
          <dt className="text-ink-muted">Workspace</dt>
          <dd className="text-ink">
            {identityResult.identity.workspaceName ?? "(not exposed)"}
          </dd>
        </dl>
      ) : identityResult.configured ? (
        <p className="text-sm text-error-500">{identityResult.error}</p>
      ) : (
        <p className="text-sm text-ink-muted">
          Not connected — set <code className="text-xs">NOTION_API_KEY</code> to
          enable.
        </p>
      )}
    </div>
  );
}
