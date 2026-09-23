import { hasPermission } from "@stayw/auth";
import { PageHeader, SectionHeader } from "@stayw/ui";

import {
  fetchNotionPageContentAction,
  searchNotionAction,
  searchNotionLibraryAction,
  updateNotionBlockContentAction,
  updateNotionFieldAction,
} from "@/domains/integrations/actions";
import { NotionLibraryBrowser } from "@/domains/integrations/components/NotionLibraryBrowser";
import { NotionListingsSearch } from "@/domains/integrations/components/NotionListingsSearch";
import { NotionRecentActivity } from "@/domains/integrations/components/NotionRecentActivity";
import { NotionSearch } from "@/domains/integrations/components/NotionSearch";
import { NotionSopLibrary } from "@/domains/integrations/components/NotionSopLibrary";
import { NotionWorkspaceTabs } from "@/domains/integrations/components/NotionWorkspaceTabs";
import { NOTION_SOPS_ROOT_PAGE_ID } from "@/domains/integrations/config/notion-sop-library";
import {
  buildNotionListingClientDto,
  getConfirmedNotionPropertyAssociations,
  getNotionIntegrationConfigStatus,
  getNotionIntegrationIdentity,
  getNotionPageContent,
  listNotionLibraryEntries,
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

  // The real, separate "LIBRARY" database (2026-09-24, Michelle's request)
  // — kept structurally distinct from both SOPs (a single page, not a
  // database) and "View of Listings" (a different database entirely,
  // unchanged): Property Directory, Owner Info, Service Providers List,
  // Property Lockboxes Code, and whatever else lives there, each opened on
  // demand exactly like a SOP's own `child_page` entry. Same
  // `integrations:read` gate as every other Notion read on this page — an
  // unauthorized user never reaches this fetch at all (assertPermission
  // inside listNotionLibraryEntries() itself), so its own content is only
  // ever rendered to an authorized requester.
  const libraryResult = await listNotionLibraryEntries(actor);

  // Admin/ops-manager-only diagnostic (same integrations:read gate every
  // other Notion read on this page already requires — see
  // getNotionIntegrationIdentity()'s own doc comment for why no stricter
  // permission exists yet). Answers "which Notion integration is THIS
  // environment's NOTION_API_KEY" directly from the running app itself,
  // without ever needing the credential's value revealed for comparison.
  // Never rendered for a user without integrations:read, rather than
  // rendered empty, so this never implies "not configured" when the real
  // answer is "no access."
  const canSeeConnectionDiagnostics = await hasPermission(
    actor,
    "integrations:read",
  );
  const identityResult = canSeeConnectionDiagnostics
    ? await getNotionIntegrationIdentity(actor)
    : null;

  return (
    <div>
      <PageHeader
        title="Notion"
        subtitle="Real, read-only search across everything shared with the StayWhile Notion integration — properties, procedures, guidebooks, and more."
      />
      <div className="space-y-10">
        {identityResult !== null && (
          <div>
            <SectionHeader title="Connection diagnostics" size="lg" />
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
                Not connected — set{" "}
                <code className="text-xs">NOTION_API_KEY</code> to enable.
              </p>
            )}
          </div>
        )}
        <div>
          <SectionHeader title="Search All Notion" size="lg" />
          <NotionSearch
            action={searchNotionAction}
            fetchContentAction={fetchNotionPageContentAction}
            updateBlockAction={updateNotionBlockContentAction}
          />
        </div>
        <NotionWorkspaceTabs
          sopsContent={
            sopLibraryResult.configured && sopLibraryResult.ok ? (
              <NotionSopLibrary
                rootPageId={NOTION_SOPS_ROOT_PAGE_ID}
                library={sopLibraryResult.content}
                rootEditableBlockIds={sopLibraryEditableBlockIds}
                fetchContentAction={fetchNotionPageContentAction}
                updateBlockAction={updateNotionBlockContentAction}
              />
            ) : sopLibraryResult.configured ? (
              <p className="text-sm text-error-500">{sopLibraryResult.error}</p>
            ) : null
          }
          libraryContent={
            libraryResult.configured && libraryResult.ok ? (
              <NotionLibraryBrowser
                entries={libraryResult.items}
                fetchContentAction={fetchNotionPageContentAction}
                updateBlockAction={updateNotionBlockContentAction}
                searchAction={searchNotionLibraryAction}
              />
            ) : libraryResult.configured ? (
              <p className="text-sm text-error-500">{libraryResult.error}</p>
            ) : null
          }
          listingsContent={
            <NotionListingsSearch
              listings={listingsWithVisibility}
              updateFieldAction={updateNotionFieldAction}
            />
          }
        />
        {recentActivity !== null && (
          <NotionRecentActivity items={recentActivity} />
        )}
      </div>
    </div>
  );
}
