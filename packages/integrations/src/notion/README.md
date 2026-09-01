# Notion integration

Status: real HTTP client against the Notion API — `connect`/`healthCheck`/`validateCredentials` all call `/users/me`; `sync("INBOUND")` calls `/search` and reports how many pages/databases the integration token can see.

Capabilities: sync.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once wired into a caller (convention, not schema-enforced) — this package doesn't write that row itself.

**`sync` deliberately does not write anything.** Notion has no single "list everything relevant" endpoint the way OwnerRez has `/bookings` — which pages/databases a StayWhile sync should target, and what StayWhile record they'd map to (`Property.notionPageId` already exists in the schema as a likely target), is a design decision that hasn't been made yet. `sync("OUTBOUND")` rejects outright for the same reason.

Credentials: `NOTION_API_KEY` (Bearer auth, internal integration token) — see `.env.example`. Verified live 2026-08-15 (`validateCredentials()` succeeded against the real StayWhile workspace); every write-capable method below is still unimplemented.

## `queryDataSource()` — one-row proof read against a specific data source

Added 2026-08-25 to prove/read a single named data source (e.g. Michelle's property database, "View of Listings") directly, rather than relying on generic `/search`. Read-only: Notion's data-source query endpoint reads rows, never writes. Takes a `dataSourceId` (see `NOTION_LISTINGS_DATA_SOURCE_ID` in `.env.example`) and an optional page size (defaults to 1), and returns only `{ resultCount, firstTitle }` — never full row content.

**Requires a newer `Notion-Version` header than every other method in this client.** Notion's data-source query endpoint did not exist before multi-source databases shipped, and requires `2026-03-11` (confirmed live against Notion's current API reference, 2026-08-25) — see `NOTION_DATA_SOURCE_QUERY_VERSION` in `client.ts`. This is sent as a **per-request header override only**; the client's global default (`NOTION_VERSION = "2022-06-28"`) is untouched, so `/users/me`, `sync()`, and `listRecentlyEdited()` are unaffected. Do not change `NOTION_VERSION` itself to fix this — that would be a breaking change to `/search`'s response shape (see HANDOFF.md Increment 44 for why).

**Before this can succeed against a real data source**: the data source's _parent database_ — not the data source itself, which has no independent permission setting — must be explicitly shared with this integration in Notion's UI (••• → Add connections, or the adjacent Share button). The ID alone does not grant access. A `404` from this method means either "not shared yet" or "invalid ID" — Notion's API deliberately does not distinguish the two, to avoid leaking existence.

## `listDataSourceRecords()` — full, paginated, read-only listing retrieval

Added 2026-08-26 to power the `/notion` dashboard page's real listing display and search. Unlike `queryDataSource()` (a one-row access proof), this fetches **every** row in a data source, following Notion's real cursor pagination (`has_more`/`next_cursor`) to completion — never just the first page. Two independent safeguards against a runaway loop, mirroring the same discipline applied to the OwnerRez pagination fix (see HANDOFF.md): a hard page cap, and rejection of a `next_cursor` value already seen in the same call. Also refuses to silently truncate if Notion ever reports `has_more: true` without a usable `next_cursor`.

"View of Listings"'s real property schema (confirmed live 2026-08-26 via `GET /v1/data_sources/{id}`) is hardcoded as named constants in `client.ts` (`LISTING_PROPERTY`) rather than re-discovered per request — this is stable metadata, not runtime data. Each row is mapped to the narrow `NotionListingRecord` shape (id, url, name, address, bedrooms, bathrooms, guests, directBooking, airbnbLink, vrboLink, googleDrivePhotosUrl, guidebookUrl) — the raw Notion properties map never leaves `client.ts`, and in particular never reaches a React Client Component. Region is deliberately not part of this type: it's resolved app-side against a known-subset reference table, not a Notion field (there is no Region property in this data source).

## Current read-only status, and the future write-back requirement (updated 2026-09-02 — corrects/supersedes the original "Hard safety requirement, 2026-08-15" framing that used to state Notion must _never_ have write capability)

**Notion is currently read-only.** No create/update/delete/archive/rename/append call exists anywhere in this client, and none should be added without following the process below. This is a current-state fact, not a permanent architectural rule: the client has confirmed a **future requirement** for StayWhile to become the operational interface for certain specifically-approved Notion information — approved changes made from the StayWhile dashboard, written back to Notion.

**Controlled dashboard-to-Notion updates are a future requirement and must be implemented only for explicitly approved fields/actions, with RBAC, validation, and audit logging** — never as a generic Notion editor. Concretely, when that work is designed and approved, each piece must have: an explicit, client-approved list of exactly which fields/actions are editable (never "everything Notion allows"); dedicated RBAC for that specific write (not inherited from a broader `integrations:*`/`smart_devices:*` grant); server-side validation; audit logging via `recordAudit`, the same standard already applied to every other write path in this app; and confirmation UI where appropriate. **Deletion/archive capability is out of scope unless separately approved**, on top of all of the above.

**Until that design work happens and is explicitly approved, field by field**, this package stays read-only: do not implement `sync("OUTBOUND")`, any Notion `PATCH`/create/archive call, or any block-append. Any conflict or mismatch found between Notion and StayWhile's own records must be reported to a human, never auto-resolved by writing back to Notion. This governs this specific client's configured Notion integration only; it says nothing about how any other client's Notion integration in a different workspace should behave.

**Mapping rule**: do not infer a StayWhile `Property` ↔ Notion page/database correspondence from name or address similarity, even when it looks obvious (e.g. "Miramar-Bliss" in OwnerRez vs. "🏡 Miramar Bliss" as a Notion page title vs. `MIRAMAR-BLISS` as the StayWhile `internalCode` — three different strings for what may be one property, unconfirmed). Every property mapping requires **explicit, human-confirmed** correspondence before any data gets associated with a StayWhile record — same standard already applied to `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP`.

**Before implementing any write functionality here**: the exact proposed fields/actions, the exact RBAC, and the exact validation/audit design must be shown to the client and explicitly approved first — this is a separate piece of work, not part of the current read-only search release. Read-only discovery (what this README already documents) does not require that approval.
