import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type IntegrationConnection } from "@stayw/database";
import type {
  IntegrationAuthType,
  IntegrationProvider,
} from "@stayw/database/enums";
import {
  NotionClient,
  type NotionHighlight,
  type NotionIntegrationIdentity,
  type NotionLibraryEntry,
  type NotionListingRecord,
  type NotionPageContent,
  type NotionSearchResultItem,
  type NotionSearchSourceType,
} from "@stayw/integrations/notion";
import {
  OwnerrezClient,
  type OwnerrezBooking,
  type OwnerrezProperty,
} from "@stayw/integrations/ownerrez";

export type { IntegrationConnection };

import {
  annotateNotionFieldEditability,
  type NotionEditableField,
} from "../config/notion-edit-allowlist";
import {
  selectVisibleNotionFields,
  type NotionVisibilityContext,
} from "../config/notion-field-visibility";
import { NOTION_LIBRARY_DATA_SOURCE_ID } from "../config/notion-library";
import { UNKNOWN_REGION } from "../config/notion-region-reference";
import type { DisconnectIntegrationInput } from "../schemas/integrations.schema";

import { matchesListingQuery } from "./notion-listing-match";
import { resolveRegion } from "./notion-region-matching";
import { isExcludedFromVaSearch } from "./notion-search-exclusions";

import { recordAudit } from "@/platform/audit/record-audit";

const PROVIDER_DEFAULTS: Record<
  IntegrationProvider,
  { displayName: string; authType: IntegrationAuthType }
> = {
  OWNERREZ: { displayName: "OwnerRez", authType: "API_KEY" },
  AIRBNB: { displayName: "Airbnb", authType: "API_KEY" },
  SLACK: { displayName: "Slack", authType: "API_KEY" },
  ASANA: { displayName: "Asana", authType: "API_KEY" },
  NOTION: { displayName: "Notion", authType: "API_KEY" },
  GMAIL: { displayName: "Gmail", authType: "OAUTH2" },
  GOOGLE_VOICE: { displayName: "Google Voice", authType: "API_KEY" },
  YALE: { displayName: "Yale", authType: "API_KEY" },
  AUGUST: { displayName: "August", authType: "API_KEY" },
  NEST: { displayName: "Nest", authType: "OAUTH2" },
  ECOBEE: { displayName: "Ecobee", authType: "OAUTH2" },
  CIELO: { displayName: "Cielo", authType: "API_KEY" },
  GOOGLE_SHEETS: {
    displayName: "VA/Team Schedule (Google Sheet)",
    authType: "NONE",
  },
};

/**
 * "real" means @stayw/integrations has an actual HTTP-calling client for
 * this provider (as of 2026-08-07 — see each package's README for why the
 * rest are still stubs); "stub" means every method still throws
 * NotImplementedError. Purely informational — doesn't affect `status`.
 */
export const PROVIDER_CLIENT_STATUS: Record<
  IntegrationProvider,
  "real" | "stub"
> = {
  OWNERREZ: "real",
  SLACK: "real",
  NOTION: "real",
  ASANA: "real",
  AIRBNB: "stub",
  GMAIL: "stub",
  GOOGLE_VOICE: "stub",
  YALE: "stub",
  // Real HTTP-calling clients as of 2026-08-12 (see each README for the
  // verified endpoints) — this flag is about the CLIENT existing, not about
  // whether any given SmartDevice row came from a real sync. See
  // packages/database/prisma/seed.ts's seedDemoSmartDevices(), which only
  // seeds fake AUGUST/CIELO rows when the corresponding real credentials
  // are absent, so the two stay honest together.
  AUGUST: "real",
  CIELO: "real",
  // Flipped 2026-08-21 — NestClient now makes real SDM API calls
  // (read-only: listDevices() only, no write/command path yet).
  NEST: "real",
  ECOBEE: "stub",
  // Real, unauthenticated GET against Google's own CSV export — see
  // team/services/schedule-source.ts.
  GOOGLE_SHEETS: "real",
};

/**
 * IntegrationConnection.provider is unique — this idempotently ensures a row
 * exists for every provider in the enum, so the connection-management page
 * always shows the full catalog (most `DISCONNECTED`, since no credential
 * has been wired in yet) instead of only whatever happens to have a row.
 */
export async function ensureConnectionRows(): Promise<void> {
  await Promise.all(
    (Object.keys(PROVIDER_DEFAULTS) as IntegrationProvider[]).map((provider) =>
      prisma.integrationConnection.upsert({
        where: { provider },
        create: { provider, ...PROVIDER_DEFAULTS[provider] },
        update: {},
      }),
    ),
  );
}

export async function listIntegrationConnections(actor: AuthContext) {
  await assertPermission(actor, "integrations:read");
  await ensureConnectionRows();

  return prisma.integrationConnection.findMany({
    orderBy: { provider: "asc" },
    include: {
      syncLogs: { orderBy: { startedAt: "desc" }, take: 3 },
    },
  });
}

/**
 * DB-only — sets status back to DISCONNECTED without calling the provider's
 * disconnect() (every real client's disconnect() is already a no-op: none
 * of them hold a server-side session to tear down, see each client.ts).
 */
export async function disconnectIntegration(
  actor: AuthContext,
  input: DisconnectIntegrationInput,
) {
  await assertPermission(actor, "integrations:update");

  const connection = await prisma.integrationConnection.update({
    where: { provider: input.provider },
    data: { status: "DISCONNECTED" },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "integration_connection.disconnected",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    afterState: connection,
  });

  return connection;
}

/**
 * A RUNNING IntegrationSyncLog row older than this is treated as abandoned
 * by a request that crashed or was terminated before ever calling
 * finishDeviceSync() — closed out as FAILED so the connection can't stay
 * permanently locked.
 *
 * No real historical duration sample was available when this was chosen:
 * the local dev DB's sync-log history was reset since the increments that
 * ran real syncs, and production Supabase was unreachable this session
 * (the already-documented flaky-Wi-Fi issue, not new). Instead, this is
 * derived from the exact theoretical worst case in
 * packages/integrations/src/core/http-client.ts's own retry logic: 10s
 * timeout, 2 retries (3 attempts total) + backoff ≈ 30.75s worst case per
 * HTTP call, even if every single attempt times out. August's sync makes
 * one listLocks() + one getLockDetail() per lock (8 calls today, 7 real
 * locks) ≈ 246s (~4.1 min) worst case; Cielo makes login()+listDevices()
 * (2 calls) ≈ 62s worst case. 10 minutes gives comfortable margin over
 * today's worst case AND real near-term growth — Michelle is expected to
 * grant access to more August locks (see HANDOFF.md's Priority 7) — while
 * staying short enough that a genuinely crashed request self-heals within
 * a reasonable window rather than blocking a connection all day.
 *
 * Exported (2026-09-23) so lock-refresh.service.ts's
 * refreshAugustTelemetryAutomatic() reuses this exact same value for its
 * own RUNNING-row staleness check, rather than defining a second, different
 * threshold — both functions evaluate staleness against the SAME
 * IntegrationSyncLog row for the same AUGUST connection (via the shared
 * `integration_sync` advisory lock name), so if they disagreed on what
 * counts as "stale," a request landing in the gap between the two values
 * could incorrectly conclude a still-genuinely-running job had crashed and
 * start a second, overlapping one — defeating the whole point of this
 * mechanism. Re-verified against the newer, larger ProviderDevice-scoped
 * August fleet (currently up to ~43 locks, AUGUST_DETAIL_CONCURRENCY(5)
 * bounded — ~9 sequential batches, ≈277s/~4.6min worst case even if every
 * batch hits the full retry ceiling) — still comfortably under this
 * threshold, not just the original 7-lock legacy estimate above.
 */
export const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Starts a manual smart-device sync against a SPECIFIC IntegrationConnection
 * row, identified by its real id — not by provider name. `provider` is
 * still passed and checked against the connection's actual provider as a
 * cheap defensive guard (catches a button ever being wired to the wrong
 * connection), but it is never used to look the connection up. This is
 * deliberate: a provider name is not a safe identifier for "which
 * connection" the moment more than one connection could exist for the same
 * provider (see the standing ProviderDevice/multi-account design work —
 * not implemented yet, but this function doesn't bake in the assumption
 * that would need undoing later).
 *
 * The check-for-RUNNING-then-create-RUNNING step is wrapped in a Postgres
 * advisory lock — the two-key form, pg_try_advisory_xact_lock(key1, key2) —
 * NOT a single hashed bigint. key1 is a fixed namespace
 * (hashtext('integration_sync'), a stable constant for this whole feature);
 * key2 is derived from connectionId. This isn't awkward in Prisma at all
 * (a $queryRaw template just takes two interpolated args instead of one),
 * so there's no reason to fall back to a single key: the two-key form means
 * this feature's lock keyspace can never collide with any unrelated
 * advisory lock some other future feature picks, since it lives in its own
 * namespace rather than sharing the single 64-bit space with everything
 * else in the app. (For the record, a single hashtext(connectionId)::bigint
 * key would also have been low-risk on its own — a 64-bit hash space has
 * negligible collision probability at this app's scale, a handful of
 * connections ever — but "low-risk" isn't the same as "can't collide by
 * construction," and the two-key form costs nothing extra to get the
 * stronger guarantee.)
 *
 * The lock is transaction-scoped: it's held only for this handful of fast
 * local queries and releases the instant the transaction commits, a few
 * milliseconds later. The slow part — the actual August/Cielo HTTP call —
 * deliberately happens OUTSIDE this transaction, in the caller (see
 * actions.ts's runDeviceSync), so nothing here holds a DB transaction open
 * across a slow external request. That distinction matters specifically
 * because production's DATABASE_URL uses Supabase's transaction-mode
 * pooler (?pgbouncer=true&connection_limit=1, see HANDOFF.md Increment 24)
 * — holding a lock across a slow external call under that pooler would be
 * genuinely risky; a few local queries are not.
 *
 * Returns `{ alreadyRunning: true }` without writing anything if a RUNNING
 * row already exists and is still fresh. A stale RUNNING row (older than
 * STALE_RUNNING_THRESHOLD_MS) is closed out as FAILED first, then a new
 * sync proceeds — this is the crashed-request recovery path.
 */
export async function beginDeviceSync(
  actor: AuthContext,
  connectionId: string,
  provider: "AUGUST" | "CIELO",
): Promise<
  | { logId: string; alreadyRunning: false }
  | { alreadyRunning: true }
  | { wrongConnection: true }
> {
  await assertPermission(actor, "integrations:update");

  const connection = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection || connection.provider !== provider) {
    return { wrongConnection: true };
  }

  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('integration_sync'), hashtext(${connectionId})) AS locked
    `;
    if (!lockRows[0]?.locked) {
      // Another request is inside this exact critical section right now.
      return { alreadyRunning: true } as const;
    }

    const existingRunning = await tx.integrationSyncLog.findFirst({
      where: { integrationConnectionId: connection.id, status: "RUNNING" },
    });

    if (existingRunning) {
      const ageMs = Date.now() - existingRunning.startedAt.getTime();
      if (ageMs < STALE_RUNNING_THRESHOLD_MS) {
        return { alreadyRunning: true } as const;
      }
      await tx.integrationSyncLog.update({
        where: { id: existingRunning.id },
        data: {
          status: "FAILED",
          errorMessage:
            "Sync timed out or the process terminated unexpectedly.",
          finishedAt: new Date(),
        },
      });
    }

    const log = await tx.integrationSyncLog.create({
      data: {
        integrationConnectionId: connection.id,
        direction: "INBOUND",
        entityType: "SmartDevice",
        status: "RUNNING",
      },
    });

    return { logId: log.id, alreadyRunning: false } as const;
  });
}

/**
 * Finishes a sync started by beginDeviceSync() — updates the SAME log row
 * (never creates a second one) to its terminal status. Only a SUCCEEDED
 * outcome flips the connection to CONNECTED and bumps lastSyncedAt; a FAILED
 * outcome is still logged with its error message, but the connection's
 * lastSyncedAt is left untouched — this is what "preserve the last good
 * data when a new sync fails" means at the connection-status level (the
 * device-row upserts themselves already only ever apply to devices actually
 * returned by a successful provider call, per syncAugustDevices/
 * syncCieloDevices' own per-device upsert loop).
 */
export async function finishDeviceSync(
  actor: AuthContext,
  logId: string,
  result:
    | { status: "SUCCEEDED"; recordsProcessed: number }
    | { status: "FAILED"; errorMessage: string },
): Promise<void> {
  await assertPermission(actor, "integrations:update");

  const log = await prisma.integrationSyncLog.update({
    where: { id: logId },
    data: {
      status: result.status,
      recordsProcessed:
        result.status === "SUCCEEDED" ? result.recordsProcessed : 0,
      errorMessage: result.status === "FAILED" ? result.errorMessage : null,
      finishedAt: new Date(),
    },
  });

  if (result.status === "SUCCEEDED") {
    await prisma.integrationConnection.update({
      where: { id: log.integrationConnectionId },
      data: { status: "CONNECTED", lastSyncedAt: new Date() },
    });
  }
}

/**
 * Shared shape for every "read live data from a real-client provider for
 * dashboard display" function below. `configured: false` means the env
 * credential simply isn't set — a normal, expected state, not an error.
 * `ok: false` means a credential exists but the live call itself failed
 * (bad token, network, rate limit, etc.) — still not invented data, just a
 * real failure surfaced instead of swallowed.
 */
export type IntegrationHighlights<T> =
  | { configured: false }
  | { configured: true; ok: true; items: T[] }
  | { configured: true; ok: false; error: string };

/**
 * Real, read-only call to Notion's API — no fabricated data. Not wired to
 * any button/manual trigger; called directly by the dashboard, gated on
 * NOTION_API_KEY actually being set. See packages/integrations/src/notion
 * for what "real" means here (genuine HTTP calls) vs. the still-stubbed
 * providers.
 */
export async function getNotionHighlights(
  actor: AuthContext,
): Promise<IntegrationHighlights<NotionHighlight>> {
  await assertPermission(actor, "integrations:read");

  const token = process.env.NOTION_API_KEY;
  if (!token) return { configured: false };

  try {
    const client = new NotionClient({ token });
    const items = await client.listRecentlyEdited(5);
    return { configured: true, ok: true, items };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : "Notion request failed.",
    };
  }
}

/**
 * A specific, named reason the one-row proof read below failed, distinguished
 * only as far as Notion's own API actually allows (see packages/integrations/
 * src/notion/README.md and HANDOFF.md Increments 44/45): "unauthorized" (401,
 * bad/revoked token) vs. "not_found_or_no_access" (404 — Notion deliberately
 * returns the same status for "not shared with this integration" and "no such
 * data source", to avoid leaking existence) vs. "version_or_validation_error"
 * (400) vs. "unexpected_error" (anything else, e.g. a network failure).
 */
export type NotionListingsAccessProofFailureReason =
  | "unauthorized"
  | "not_found_or_no_access"
  | "version_or_validation_error"
  | "unexpected_error";

export type NotionListingsAccessProof =
  | { configured: false }
  | {
      configured: true;
      ok: true;
      resultCount: number;
      firstTitle: string | null;
    }
  | {
      configured: true;
      ok: false;
      reason: NotionListingsAccessProofFailureReason;
      error: string;
    };

function classifyNotionProofFailure(
  err: unknown,
): NotionListingsAccessProofFailureReason {
  const message = err instanceof Error ? err.message : "";
  const status = /failed with (\d+)/.exec(message)?.[1];
  if (status === "401") return "unauthorized";
  if (status === "404") return "not_found_or_no_access";
  if (status === "400") return "version_or_validation_error";
  return "unexpected_error";
}

/**
 * One-row, read-only proof that a specific Notion data source (e.g.
 * Michelle's "View of Listings" property database) is shared with this
 * integration and readable — never a full content dump, never a write.
 * Requires both NOTION_API_KEY and NOTION_LISTINGS_DATA_SOURCE_ID to be set;
 * neither value is ever logged or returned by this function.
 */
export async function getNotionListingsAccessProof(
  actor: AuthContext,
): Promise<NotionListingsAccessProof> {
  await assertPermission(actor, "integrations:read");

  const token = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
  if (!token || !dataSourceId) return { configured: false };

  try {
    const client = new NotionClient({ token });
    const { resultCount, firstTitle } = await client.queryDataSource(
      dataSourceId,
      1,
    );
    return { configured: true, ok: true, resultCount, firstTitle };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      reason: classifyNotionProofFailure(err),
      error: err instanceof Error ? err.message : "Notion request failed.",
    };
  }
}

/** A "View of Listings" row plus its app-side-resolved region and the data source it came from — never a raw Notion property object. `dataSourceId` is structural plumbing (needed to submit an edit request against the right data source), never operational content. */
export type NotionListingWithRegion = NotionListingRecord & {
  region: string;
  dataSourceId: string;
};

/**
 * The SAFE CLIENT DTO for a Notion listing — the only shape of a listing
 * that may ever be passed to a client component. Deliberately NOT a
 * `NotionListingWithRegion & {...}` intersection: that would keep every raw
 * record field (`name`, `address`, ...) directly, unfiltered, on the
 * object, with `visibleFields` merely an additive, easy-to-ignore extra
 * array alongside it — exactly the "sent but not rendered" shape this type
 * exists to rule out. `fields` is the only place a listing's Notion
 * property values live here, and it is never anything but the `fields`
 * returned by selectVisibleNotionFields() — see buildNotionListingClientDto
 * below, the one function that may construct this type.
 *
 * `id`/`url`/`lastEditedTime`/`region`/`dataSourceId` are not gated by the
 * visibility allowlist: `id` is Notion's page identifier (structural
 * plumbing, not operational content), `url` is the explicitly-approved
 * "Open in Notion" fallback link, `lastEditedTime` is conflict/staleness
 * metadata (and the optimistic-concurrency token an edit submission must
 * echo back), `dataSourceId` is which data source an edit request targets,
 * and `region` is app-computed from the property name against a static
 * reference list — never raw Notion content.
 *
 * `visibleFields` is `NotionEditableField[]`, a strict superset of
 * `NotionVisibleField[]` — every field also carries whether an edit control
 * should render for it (see annotateNotionFieldEditability's own doc
 * comment for why that's a UX decision only, never the security boundary).
 */
export interface NotionListingWithVisibility {
  id: string;
  url: string | null;
  lastEditedTime: string | null;
  region: string;
  dataSourceId: string;
  /** Only the fields this actor is authorized to see. Never spread a NotionListingRecord/NotionListingWithRegion into this shape. */
  fields: Partial<NotionListingRecord>;
  visibleFields: NotionEditableField[];
  propertyContext: NotionPropertyAssociation | null;
}

/**
 * The one and only place a NotionListingWithVisibility (the safe client
 * DTO) may be constructed. Takes the full server-side NotionListingWithRegion
 * (which itself must never cross the server/client boundary) and returns
 * only what selectVisibleNotionFields() actually authorized — see that
 * function's own doc comment for why `record` itself must never be spread
 * into the result. `canEdit` is the actor's `notion:update` grant, checked
 * by the caller (a plain server-computed boolean, same convention as
 * `canSeeSensitiveFields`) — combined here with the (separate, currently
 * empty) edit allowlist via annotateNotionFieldEditability().
 */
export function buildNotionListingClientDto(
  record: NotionListingWithRegion,
  visibilityContext: NotionVisibilityContext,
  propertyContext: NotionPropertyAssociation | null,
  canEdit: boolean,
): NotionListingWithVisibility {
  const { fields, list } = selectVisibleNotionFields(record, visibilityContext);
  return {
    id: record.id,
    url: record.url,
    lastEditedTime: record.lastEditedTime,
    region: record.region,
    dataSourceId: record.dataSourceId,
    fields,
    visibleFields: annotateNotionFieldEditability(
      list,
      record.dataSourceId,
      canEdit,
    ),
    propertyContext,
  };
}

/**
 * Real, read-only, fully paginated read of every row in "View of Listings" —
 * the data source this dashboard's search/listing display is built on. Not
 * a proof read (unlike getNotionListingsAccessProof above): this returns
 * every real row, each with an app-side-resolved `region` attached (see
 * notion-region-matching.ts) — never inferred from Notion content, and
 * "Unknown / Unassigned" whenever a listing's name isn't in the known
 * 38-property reference. This drives the live connection/read-access status
 * shown on the /notion page — a failed call here must not be masked by a
 * stale "verified" message.
 */
export async function listNotionListings(
  actor: AuthContext,
): Promise<IntegrationHighlights<NotionListingWithRegion>> {
  await assertPermission(actor, "integrations:read");

  const token = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
  if (!token || !dataSourceId) return { configured: false };

  try {
    const client = new NotionClient({ token });
    const records = await client.listDataSourceRecords(dataSourceId);
    const items = records.map((record) => ({
      ...record,
      region: resolveRegion(record.name),
      dataSourceId,
    }));
    return { configured: true, ok: true, items };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : "Notion request failed.",
    };
  }
}

/**
 * Sorts already-fetched real bookings to surface upcoming ones first (soonest
 * arrival first), falling back to the most recently arrived past bookings if
 * there are no upcoming ones — client-side re-ordering of real data, not a
 * server-side filter. OwnerRez's v2 `since_utc` booking-list parameter isn't
 * confirmed to filter by arrival date rather than last-modified date, so it
 * isn't used here for that purpose; guessing at unverified query-param
 * semantics would risk silently returning the wrong bookings.
 */
function pickRelevantBookings(
  bookings: OwnerrezBooking[],
  limit: number,
): OwnerrezBooking[] {
  const now = Date.now();
  const upcoming = bookings
    .filter((b) => new Date(b.arrival).getTime() >= now)
    .sort(
      (a, b) => new Date(a.arrival).getTime() - new Date(b.arrival).getTime(),
    );
  if (upcoming.length > 0) return upcoming.slice(0, limit);

  return [...bookings]
    .sort(
      (a, b) => new Date(b.arrival).getTime() - new Date(a.arrival).getTime(),
    )
    .slice(0, limit);
}

/**
 * Real, read-only call to OwnerRez's API — no fabricated data. Deliberately
 * does not write into Reservation/Guest (see OwnerrezClient.sync()'s own
 * comment — that mapping needs its own identity-matching design, a
 * separate follow-up). Gated on OWNERREZ_USERNAME + OWNERREZ_API_TOKEN
 * both being set.
 */
export async function getOwnerRezHighlights(
  actor: AuthContext,
  limit = 5,
): Promise<IntegrationHighlights<OwnerrezBooking>> {
  await assertPermission(actor, "integrations:read");

  const username = process.env.OWNERREZ_USERNAME;
  const token = process.env.OWNERREZ_API_TOKEN;
  if (!username || !token) return { configured: false };

  try {
    const client = new OwnerrezClient({ username, token });
    const bookings = await client.listBookings();
    return {
      configured: true,
      ok: true,
      items: pickRelevantBookings(bookings, limit),
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : "OwnerRez request failed.",
    };
  }
}

/**
 * Real, read-only call to OwnerRez's /properties — no fabricated data, no
 * cap (a property portfolio is small/finite, unlike a rolling booking
 * window). OwnerRez remains the source of truth for the property
 * portfolio: this never writes into StayWhile's Property table.
 */
export async function getOwnerRezProperties(
  actor: AuthContext,
): Promise<IntegrationHighlights<OwnerrezProperty>> {
  await assertPermission(actor, "integrations:read");

  const username = process.env.OWNERREZ_USERNAME;
  const token = process.env.OWNERREZ_API_TOKEN;
  if (!username || !token) return { configured: false };

  try {
    const client = new OwnerrezClient({ username, token });
    const items = await client.listProperties();
    return { configured: true, ok: true, items };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : "OwnerRez request failed.",
    };
  }
}

// How a general search() result's sourceType (see NotionClient.search()) is
// labeled on a result card — never invented per-call, one fixed mapping.
const SOURCE_TYPE_LABEL: Record<NotionSearchSourceType, string> = {
  database: "Notion database",
  database_row: "Database row",
  page: "Notion page",
};

/**
 * One VA-facing search result card — either a matched "View of Listings"
 * row (richer: region + address-as-snippet, reusing exactly the same match
 * rule as the existing Listings section) or a general workspace match
 * (whatever else is shared with the integration: SOPs, FAQs, property
 * pages, directories, etc.) — never a raw Notion object, never page/block
 * content beyond a title.
 */
export interface NotionSearchResultCard {
  id: string;
  title: string;
  url: string | null;
  lastEditedTime: string | null;
  contentType: string;
  region: string | null;
  snippet: string | null;
}

export type NotionSearchState =
  | { configured: false }
  | {
      configured: true;
      ok: true;
      query: string;
      results: NotionSearchResultCard[];
    }
  | { configured: true; ok: false; query: string; error: string };

// A live, user-typed query only needs Notion's own relevance-ranked top
// results, not an exhaustive workspace crawl — kept small and separate from
// NotionClient.search()'s own default cap (used by the one-time,
// unscoped accessible-scope discovery script only).
const LIVE_SEARCH_MAX_PAGES = 3;

/**
 * The unified "Search Notion" feature backing the /notion page's search box
 * (see NotionSearch.tsx). Combines two real, read-only reads, both against
 * exactly what's already shared with this integration — never a client-side
 * dump of full workspace content:
 *
 *  1. A live, server-side Notion /search(query) call (NotionClient.search())
 *     — whatever pages/databases this integration can see, Notion's own
 *     relevance ranking, minimal fields only (title/url/lastEditedTime/
 *     sourceType).
 *  2. If NOTION_LISTINGS_DATA_SOURCE_ID is configured, the same
 *     listDataSourceRecords() read the existing Listings section already
 *     uses, filtered by the same matchesListingQuery() rule that section's
 *     keyword filter uses — richer result (region + address as a snippet)
 *     for a property-listing match specifically.
 *
 * Results are merged, listing matches first (richer context), general
 * matches after (deduped by id — a listing row would otherwise also surface
 * through /search as a lower-context duplicate of the same object).
 */
export async function searchNotionContent(
  actor: AuthContext,
  rawQuery: string,
): Promise<NotionSearchState> {
  await assertPermission(actor, "integrations:read");

  const token = process.env.NOTION_API_KEY;
  if (!token) return { configured: false };

  const query = rawQuery.trim();
  if (!query) return { configured: true, ok: true, query, results: [] };

  try {
    const client = new NotionClient({ token });

    const dataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    const listingMatches: NotionSearchResultCard[] = [];
    if (dataSourceId) {
      const listings = await client.listDataSourceRecords(dataSourceId);
      for (const listing of listings) {
        if (!matchesListingQuery(listing, query)) continue;
        listingMatches.push({
          id: listing.id,
          title: listing.name,
          url: listing.url,
          lastEditedTime: null,
          contentType: "Property listing",
          region: resolveRegion(listing.name),
          snippet: listing.address,
        });
      }
    }

    const seenIds = new Set(listingMatches.map((r) => r.id));
    const generalResults = await client.search({
      query,
      maxPages: LIVE_SEARCH_MAX_PAGES,
    });
    const generalCards: NotionSearchResultCard[] = generalResults
      .filter((r: NotionSearchResultItem) => !seenIds.has(r.id))
      // VA search is an operational-knowledge search, not a browser for
      // every object the integration token happens to have access to — see
      // notion-search-exclusions.ts. Excluded by real database id only,
      // never by title, so operational content is never dropped just
      // because it mentions a person's name.
      .filter((r: NotionSearchResultItem) => !isExcludedFromVaSearch(r))
      .map((r: NotionSearchResultItem) => {
        const region = resolveRegion(r.title);
        return {
          id: r.id,
          title: r.title,
          url: r.url,
          lastEditedTime: r.lastEditedTime,
          contentType: SOURCE_TYPE_LABEL[r.sourceType],
          region: region === UNKNOWN_REGION ? null : region,
          snippet: null,
        };
      });

    return {
      configured: true,
      ok: true,
      query,
      results: [...listingMatches, ...generalCards],
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      query,
      error: err instanceof Error ? err.message : "Notion search failed.",
    };
  }
}

/**
 * Real, read-only result of fetching one Notion page's actual body content
 * (headings/paragraphs/callouts/lists/toggles/tables) — same
 * IntegrationHighlights-style discriminated shape as every other live read
 * above: `configured: false` means NOTION_API_KEY isn't set, `ok: false`
 * means a real read failure (bad token, page not shared with this
 * integration, network error), never fabricated content either way.
 *
 * Unlike getNotionHighlights/getNotionListingsAccessProof/searchNotionContent
 * above, `error` here is NEVER the raw `err.message` from a failed Notion
 * call — see getNotionPageContent()'s own doc comment for why this one
 * specifically is held to a stricter, sanitize-at-the-service-boundary
 * standard.
 */
export type NotionPageContentResult =
  | { configured: false }
  | { configured: true; ok: true; content: NotionPageContent }
  | { configured: true; ok: false; error: string };

/** The only text a real getPageContent() failure is ever allowed to surface past this function — see getNotionPageContent()'s own doc comment. */
const NOTION_PAGE_CONTENT_GENERIC_ERROR =
  "Couldn't load this page's content from Notion. Please try again.";

/**
 * Backs the "read the real SOP/page content inline" experience (see
 * NotionSearch.tsx) — called only once a user actually opens a specific
 * search result, never eagerly for every result in a list. `pageId` is
 * whatever id the search results the actor already has access to expose
 * (see searchNotionContent above) — this performs no further access check
 * beyond the same `integrations:read` permission every other Notion read in
 * this file requires, since a page's real Notion sharing (this integration
 * token's own access grant) is already the actual authorization boundary;
 * this function can't reveal any page the token itself couldn't already
 * read directly.
 *
 * A real `getPageContent()` failure can be an arbitrary Notion API error
 * string, a raw HTTP status line, or a network-layer message — none of it
 * vetted for what it might contain, and a page id (arbitrary,
 * user-influenced input) is now part of the request that produced it. Unlike
 * the other read functions in this file (whose `error` is only ever shown on
 * an admin-only diagnostic surface), this failure reaches every
 * `integrations:read` user through the general search UI, so the real
 * message is logged server-side only (`console.error`) and the caller —
 * the action, and everything past it — only ever sees the fixed
 * NOTION_PAGE_CONTENT_GENERIC_ERROR text. This is a deliberate, independent
 * sanitization boundary: NotionSearch.tsx's own error rendering already
 * shows a fixed generic message today, but that's a UI choice that could
 * change; this function's contract can't be defeated by a future UI that
 * decides to render `error` directly.
 */
export async function getNotionPageContent(
  actor: AuthContext,
  pageId: string,
): Promise<NotionPageContentResult> {
  await assertPermission(actor, "integrations:read");

  const token = process.env.NOTION_API_KEY;
  if (!token) return { configured: false };

  try {
    const client = new NotionClient({ token });
    const content = await client.getPageContent(pageId);
    return { configured: true, ok: true, content };
  } catch (err) {
    console.error("getNotionPageContent failed:", err);
    return {
      configured: true,
      ok: false,
      error: NOTION_PAGE_CONTENT_GENERIC_ERROR,
    };
  }
}

/**
 * Backs the "browse the real LIBRARY database" experience — item "Notion
 * Library" (2026-09-24), Michelle's request. Same `integrations:read` gate,
 * same sanitize-at-the-boundary discipline, and the same "the token's own
 * Notion sharing is the real authorization boundary" reasoning as
 * getNotionPageContent() above: this can't reveal any LIBRARY row the
 * integration token couldn't already read directly. Returns only
 * id/title/url/lastEditedTime per entry (see NotionLibraryEntry /
 * listDataSourceEntries()) — never any other property a LIBRARY row might
 * carry, so a value like a lockbox code stored on some other column of one
 * of these rows (unlikely given the real schema found, but not assumed)
 * could never reach this function's caller even by accident. A specific
 * entry's own page BODY content (where real operational detail like a
 * lockbox code actually lives) is fetched separately, on demand, only when
 * an authorized user opens that specific entry — via the exact same
 * getNotionPageContent() above, never eagerly for the whole list.
 */
export async function listNotionLibraryEntries(
  actor: AuthContext,
): Promise<IntegrationHighlights<NotionLibraryEntry>> {
  await assertPermission(actor, "integrations:read");

  const token = process.env.NOTION_API_KEY;
  if (!token) return { configured: false };

  try {
    const client = new NotionClient({ token });
    const items = await client.listDataSourceEntries(
      NOTION_LIBRARY_DATA_SOURCE_ID,
    );
    return { configured: true, ok: true, items };
  } catch (err) {
    console.error("listNotionLibraryEntries failed:", err);
    return {
      configured: true,
      ok: false,
      error: NOTION_PAGE_CONTENT_GENERIC_ERROR,
    };
  }
}

/**
 * Non-network, config-only status for the dedicated Notion page. Deliberately
 * does NOT call the live queryDataSource() proof (getNotionListingsAccessProof
 * above) on every render — that's a real Notion API call, and this status is
 * meant to render instantly and safely on every page load. Only reports
 * whether NOTION_API_KEY is set — never whether access to a specific data
 * source has actually been granted, which requires a live call and stays a
 * deliberate, manually-approved action (see HANDOFF.md Increments 44-46).
 */
export async function getNotionIntegrationConfigStatus(
  actor: AuthContext,
): Promise<{ configured: boolean }> {
  await assertPermission(actor, "integrations:read");
  return { configured: Boolean(process.env.NOTION_API_KEY) };
}

/**
 * Real, read-only result of asking THIS environment's own NOTION_API_KEY
 * "which Notion integration are you" — see NotionClient.getIntegrationIdentity()
 * for exactly what's returned and why it's safe. `error` here is never a raw
 * provider string, same discipline as getNotionPageContent() above: this
 * result renders on an admin/ops-manager-only diagnostic surface, but a
 * fixed message is still simpler to reason about than deciding per-caller
 * whether a given Notion error string is safe to show.
 */
export type NotionIntegrationIdentityResult =
  | { configured: false }
  | { configured: true; ok: true; identity: NotionIntegrationIdentity }
  | { configured: true; ok: false; error: string };

const NOTION_IDENTITY_GENERIC_ERROR =
  "Couldn't verify the connected Notion integration's identity. Please try again.";

/**
 * Admin/ops-manager-only diagnostic (gated by the same `integrations:read`
 * permission every other Notion read in this file already requires — the
 * narrowest existing gate available for this data, since no more specific
 * "admin-only" permission exists in this codebase's RBAC catalog yet).
 *
 * Calls Notion's own `/users/me` using THIS running environment's actual
 * NOTION_API_KEY and returns only safe identity metadata (the integration's
 * configured display name, its bot id, and its workspace's display name if
 * Notion exposes one for its owner type) — never the token, never an
 * Authorization header, never any other workspace content. Exists to answer,
 * from the environment that actually holds the credential (local or
 * Production), "which Notion integration is this" without the credential's
 * value ever needing to be revealed for manual comparison.
 */
export async function getNotionIntegrationIdentity(
  actor: AuthContext,
): Promise<NotionIntegrationIdentityResult> {
  await assertPermission(actor, "integrations:read");

  const token = process.env.NOTION_API_KEY;
  if (!token) return { configured: false };

  try {
    const client = new NotionClient({ token });
    const identity = await client.getIntegrationIdentity();
    return { configured: true, ok: true, identity };
  } catch (err) {
    console.error("getNotionIntegrationIdentity failed:", err);
    return {
      configured: true,
      ok: false,
      error: NOTION_IDENTITY_GENERIC_ERROR,
    };
  }
}

export interface NotionPropertyAssociation {
  propertyId: string;
  propertyName: string;
}

/**
 * Confirmed Notion page ↔ StayWhile Property associations, keyed by Notion
 * page id — reads `Property.notionPageId` only, never inferred from name/
 * address similarity, matching the same standard already enforced for
 * every other provider mapping in this app (August/Cielo *_PROPERTY_MAP,
 * OwnerRez linking, Nest ProviderDevice mapping). `notionPageId` is not yet
 * populated for any property as of this pass — this correctly returns an
 * empty map today, so the in-dashboard detail view shows no property
 * context for anything until a human explicitly sets this field for a
 * specific property (a separate, not-yet-built admin action).
 */
export async function getConfirmedNotionPropertyAssociations(
  actor: AuthContext,
): Promise<Map<string, NotionPropertyAssociation>> {
  await assertPermission(actor, "integrations:read");

  const rows = await prisma.property.findMany({
    where: { notionPageId: { not: null }, deletedAt: null },
    select: { id: true, name: true, notionPageId: true },
  });

  const map = new Map<string, NotionPropertyAssociation>();
  for (const row of rows) {
    if (!row.notionPageId) continue;
    map.set(row.notionPageId, { propertyId: row.id, propertyName: row.name });
  }
  return map;
}
