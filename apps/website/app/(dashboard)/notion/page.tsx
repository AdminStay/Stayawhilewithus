import {
  EmptyState,
  PageHeader,
  SectionHeader,
  StatusIndicator,
} from "@stayw/ui";
import { Search } from "lucide-react";

import { getNotionIntegrationConfigStatus } from "@/domains/integrations/services/integrations.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function NotionPage() {
  const actor = await getCurrentUser();
  const status = await getNotionIntegrationConfigStatus(actor);

  return (
    <div>
      <PageHeader
        title="Notion"
        subtitle="Status of the read-only Notion integration and what's coming next."
      />

      <div className="space-y-10">
        <div>
          <SectionHeader title="Connection status" size="lg" />
          {status.configured ? (
            <div className="space-y-2">
              <StatusIndicator
                label="Notion connection: Connected"
                tone="success"
              />
              <StatusIndicator
                label="View of Listings: Read access verified"
                tone="success"
              />
              <StatusIndicator
                label="Property/keyword/region search: Next feature"
                tone="neutral"
              />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Not connected — set{" "}
              <code className="text-xs">NOTION_API_KEY</code> to enable.
            </p>
          )}
        </div>

        <div>
          <SectionHeader title="Property search" size="lg" />
          <EmptyState
            icon={Search}
            title="Coming soon"
            description={
              'Notion access is verified — keyword, property, and region search against Notion\'s "View of Listings" database is next up.'
            }
          />
        </div>
      </div>
    </div>
  );
}
