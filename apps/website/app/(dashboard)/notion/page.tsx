import { PageHeader, SectionHeader } from "@stayw/ui";

import { NotionListingsSearch } from "@/domains/integrations/components/NotionListingsSearch";
import {
  getNotionIntegrationConfigStatus,
  listNotionListings,
} from "@/domains/integrations/services/integrations.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function NotionPage() {
  const actor = await getCurrentUser();
  const status = await getNotionIntegrationConfigStatus(actor);

  if (!status.configured) {
    return (
      <div>
        <PageHeader
          title="Notion"
          subtitle="Status of the read-only Notion integration and property search."
        />
        <div>
          <SectionHeader title="Connection status" size="lg" />
          <p className="text-sm text-ink-muted">
            Not connected — set <code className="text-xs">NOTION_API_KEY</code>{" "}
            to enable.
          </p>
        </div>
      </div>
    );
  }

  // A real listing read happens on every load — the page's connection/
  // read-access status is derived from this actual result inside
  // NotionListingsSearch, never a hardcoded success message shown
  // regardless of whether the live request actually succeeded.
  const listings = await listNotionListings(actor);

  return (
    <div>
      <PageHeader
        title="Notion"
        subtitle="Real, read-only listings from Notion's 'View of Listings' — search by name, keyword, or region."
      />
      <div className="space-y-10">
        <div>
          <SectionHeader title="Listings" size="lg" />
          <NotionListingsSearch listings={listings} />
        </div>
      </div>
    </div>
  );
}
