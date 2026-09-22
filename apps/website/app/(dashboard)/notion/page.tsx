import { hasPermission } from "@stayw/auth";
import { PageHeader, SectionHeader } from "@stayw/ui";

import {
  fetchNotionPageContentAction,
  searchNotionAction,
  updateNotionBlockContentAction,
  updateNotionFieldAction,
} from "@/domains/integrations/actions";
import { NotionListingsSearch } from "@/domains/integrations/components/NotionListingsSearch";
import { NotionRecentActivity } from "@/domains/integrations/components/NotionRecentActivity";
import { NotionSearch } from "@/domains/integrations/components/NotionSearch";
import { NotionSopLibrary } from "@/domains/integrations/components/NotionSopLibrary";
import { NOTION_SOPS_ROOT_PAGE_ID } from "@/domains/integrations/config/notion-sop-library";
import {
  buildNotionListingClientDto,
  getConfirmedNotionPropertyAssociations,
  getNotionIntegrationConfigStatus,
  getNotionPageContent,
  listNotionListings,
  type IntegrationHighlights,
  type NotionListingWithVisibility,
} from "@/domains/integrations/services/integrations.service";
import { listRecentNotionActivity } from "@/domains/integrations/services/notion-activity.service";
import { listEditableNotionBlockIds } from "@/domains/integrations/services/notion-block-edit.service";
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

  // Sensitive-field visibility gate (notion:manage) — UX-only here, same
  // convention as every other canX check in this app: the real
  // enforcement is selectVisibleNotionFields() below running server-side,
  // not this boolean. No sensitive field is modeled yet (see
  // notion-field-visibility.ts), so this currently has no visible effect
  // either way — it exists so the mechanism is real and testable now,
  // before Kenny/Michelle approve the first sensitive field.
  const canSeeSensitiveFields = await hasPermission(actor, "notion:manage");

  // UX-only gate, same convention as canSeeSensitiveFields above — real
  // enforcement is updateNotionField()'s own independent assertPermission +
  // allowlist checks, which run again regardless of what this boolean (or a
  // tampered client) claims. NOTION_EDIT_ALLOWLIST is currently empty, so
  // annotateNotionFieldEditability() marks every field non-editable
  // regardless of this value — the dashboard stays 100% read-only today
  // even though admin already holds notion:update via its wildcard grant.
  const canEditNotion = await hasPermission(actor, "notion:update");

  // Confirmed Property.notionPageId associations only — never inferred.
  // Empty today (no property has this field populated yet), so every
  // detail view correctly shows no property context until a human sets it.
  const propertyAssociations =
    await getConfirmedNotionPropertyAssociations(actor);

  // buildNotionListingClientDto() is the ONLY place a listing may be
  // reshaped for the client component tree below — it returns only the
  // fields selectVisibleNotionFields() actually authorized for this actor,
  // never the full underlying record. See integrations.service.ts's own
  // doc comment on NotionListingWithVisibility for why this must never be
  // a `{...item, ...}` spread.
  const listingsWithVisibility: IntegrationHighlights<NotionListingWithVisibility> =
    listings.configured && listings.ok
      ? {
          configured: true,
          ok: true,
          items: listings.items.map((item) =>
            buildNotionListingClientDto(
              item,
              { canSeeSensitiveFields },
              propertyAssociations.get(item.id) ?? null,
              canEditNotion,
            ),
          ),
        }
      : listings;

  // UX-only gate, same convention as canSeeSensitiveFields above — real
  // enforcement is assertPermission("notion:read") inside
  // listRecentNotionActivity() itself. Not rendering the section at all for
  // a user without access, rather than rendering it with an empty list,
  // avoids implying "no activity" when the real answer is "no access."
  const canSeeNotionActivity = await hasPermission(actor, "notion:read");
  const recentActivity = canSeeNotionActivity
    ? await listRecentNotionActivity(actor)
    : null;

  // The real "browse the whole SOP library" read — a direct fetch of the
  // "SOPs" root page's own content, server-side, same convention as
  // listNotionListings() above. Never a hard-coded SOP list: whatever
  // Notion's real structure is right now is what renders. `editableBlockIds`
  // reuses the exact same allowlist-derived mechanism as opening a search
  // result — always [] today except for whatever page the one approved
  // controlled-test entry actually points at (never this root page).
  const sopLibraryResult = await getNotionPageContent(
    actor,
    NOTION_SOPS_ROOT_PAGE_ID,
  );
  const sopLibraryEditableBlockIds = await listEditableNotionBlockIds(
    actor,
    NOTION_SOPS_ROOT_PAGE_ID,
  );

  return (
    <div>
      <PageHeader
        title="Notion"
        subtitle="Real, read-only search across everything shared with the StayWhile Notion integration — properties, procedures, guidebooks, and more."
      />
      <div className="space-y-10">
        <div>
          <SectionHeader title="Search Notion" size="lg" />
          <NotionSearch
            action={searchNotionAction}
            fetchContentAction={fetchNotionPageContentAction}
            updateBlockAction={updateNotionBlockContentAction}
          />
        </div>
        <div>
          <SectionHeader title="SOPs" size="lg" />
          {sopLibraryResult.configured && sopLibraryResult.ok ? (
            <NotionSopLibrary
              rootPageId={NOTION_SOPS_ROOT_PAGE_ID}
              library={sopLibraryResult.content}
              rootEditableBlockIds={sopLibraryEditableBlockIds}
              fetchContentAction={fetchNotionPageContentAction}
              updateBlockAction={updateNotionBlockContentAction}
            />
          ) : sopLibraryResult.configured ? (
            <p className="text-sm text-error-500">{sopLibraryResult.error}</p>
          ) : null}
        </div>
        <div>
          <SectionHeader title="Property Listings" size="lg" />
          <NotionListingsSearch
            listings={listingsWithVisibility}
            updateFieldAction={updateNotionFieldAction}
          />
        </div>
        {recentActivity !== null && (
          <NotionRecentActivity items={recentActivity} />
        )}
      </div>
    </div>
  );
}
