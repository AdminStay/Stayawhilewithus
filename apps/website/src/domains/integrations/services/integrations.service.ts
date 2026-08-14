import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type IntegrationConnection } from "@stayw/database";
import type {
  IntegrationAuthType,
  IntegrationProvider,
} from "@stayw/database/enums";
import { NotionClient, type NotionHighlight } from "@stayw/integrations/notion";
import {
  OwnerrezClient,
  type OwnerrezBooking,
} from "@stayw/integrations/ownerrez";

export type { IntegrationConnection };

import type { DisconnectIntegrationInput } from "../schemas/integrations.schema";

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
  NEST: "stub",
  ECOBEE: "stub",
};

/**
 * IntegrationConnection.provider is unique — this idempotently ensures a row
 * exists for every provider in the enum, so the connection-management page
 * always shows the full catalog (most `DISCONNECTED`, since no credential
 * has been wired in yet) instead of only whatever happens to have a row.
 */
async function ensureConnectionRows(): Promise<void> {
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
 * Records the outcome of a smart-device sync (see
 * apps/website/src/domains/smart-devices/services/smart-devices.service.ts's
 * syncAugustDevices()/syncCieloDevices(), the only current callers) against
 * that provider's IntegrationConnection: one IntegrationSyncLog row per
 * call (the convention documented on each provider's README), and — only on
 * success — status flips to CONNECTED and lastSyncedAt updates. A failed
 * sync is still logged (status FAILED, the error message attached) rather
 * than silently dropped, but never marks the connection as connected.
 */
export async function recordIntegrationSync(
  actor: AuthContext,
  provider: "AUGUST" | "CIELO",
  result:
    | { status: "SUCCEEDED"; recordsProcessed: number }
    | { status: "FAILED"; errorMessage: string },
): Promise<void> {
  await assertPermission(actor, "integrations:update");

  const connection = await prisma.integrationConnection.upsert({
    where: { provider },
    create: { provider, ...PROVIDER_DEFAULTS[provider] },
    update: {},
  });

  await prisma.integrationSyncLog.create({
    data: {
      integrationConnectionId: connection.id,
      direction: "INBOUND",
      entityType: "SmartDevice",
      status: result.status,
      recordsProcessed:
        result.status === "SUCCEEDED" ? result.recordsProcessed : 0,
      errorMessage: result.status === "FAILED" ? result.errorMessage : null,
      finishedAt: new Date(),
    },
  });

  if (result.status === "SUCCEEDED") {
    await prisma.integrationConnection.update({
      where: { id: connection.id },
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
      items: pickRelevantBookings(bookings, 5),
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : "OwnerRez request failed.",
    };
  }
}
