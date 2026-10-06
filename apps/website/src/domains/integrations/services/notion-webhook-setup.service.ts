import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Secure Notion webhook verification-token setup (2026-09-30).
 *
 * Notion POSTs a one-time, unsigned `{ verification_token }` right after a
 * subscription is created. That token must be pasted back into Notion AND
 * becomes the HMAC key for every later event (NOTION_WEBHOOK_VERIFICATION_
 * TOKEN), so it is a secret. Previously the route wrote it to the server
 * logs. Now:
 *   - only a short SHA-256 fingerprint is ever logged;
 *   - the token is sealed (AES-256-GCM, key derived from the server-only
 *     NOTION_API_KEY) and kept on the existing NOTION IntegrationConnection
 *     row's metadata — no new table, no migration;
 *   - only while NOTION_WEBHOOK_VERIFICATION_TOKEN is NOT yet configured,
 *     only if the NOTION row exists, and only the first handshake within
 *     SETUP_WINDOW_MS (later ones are ignored, so a stray POST can't replace
 *     a genuine token mid-setup);
 *   - an admin (notion:manage) reveals it once to copy it, then clears it.
 *     Both actions are audited with the fingerprint only.
 */

export const SETUP_WINDOW_MS = 30 * 60 * 1000;
const METADATA_KEY = "webhookSetup";

interface SealedToken {
  iv: string;
  tag: string;
  data: string;
}

interface WebhookSetupRecord {
  sealed: SealedToken;
  fingerprint: string;
  receivedAt: string;
  revealedAt: string | null;
}

/** A non-reversible 12-hex-char fingerprint, safe for logs and audit. */
export function notionTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function deriveKey(keyMaterial: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      keyMaterial,
      "staywhile",
      "notion-webhook-setup-token",
      32,
    ),
  );
}

export function sealNotionToken(
  token: string,
  keyMaterial: string,
): SealedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(keyMaterial), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function openNotionToken(
  sealed: SealedToken,
  keyMaterial: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(keyMaterial),
    Buffer.from(sealed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function readSetup(metadata: unknown): WebhookSetupRecord | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[METADATA_KEY];
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<WebhookSetupRecord>;
  return r.sealed && r.fingerprint && r.receivedAt
    ? (r as WebhookSetupRecord)
    : null;
}

export type CaptureOutcome =
  | "captured"
  | "already_configured"
  | "not_configured"
  | "no_connection_row"
  | "ignored_pending";

/**
 * Called by the webhook route for the unsigned handshake only. Never
 * throws the token anywhere; logs the fingerprint and the outcome.
 */
export async function captureNotionWebhookVerificationToken(
  token: string,
  now: Date = new Date(),
): Promise<CaptureOutcome> {
  const fingerprint = notionTokenFingerprint(token);
  const log = (outcome: CaptureOutcome) => {
    console.warn(
      "[notion-webhook] verification handshake received",
      JSON.stringify({ fingerprint, outcome }),
    );
    return outcome;
  };

  if (process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN) {
    return log("already_configured");
  }
  const keyMaterial = process.env.NOTION_API_KEY;
  if (!keyMaterial) return log("not_configured");

  const row = await prisma.integrationConnection.findUnique({
    where: { provider: "NOTION" },
    select: { id: true, metadata: true },
  });
  if (!row) return log("no_connection_row");

  const existing = readSetup(row.metadata);
  if (
    existing &&
    now.getTime() - Date.parse(existing.receivedAt) < SETUP_WINDOW_MS
  ) {
    return log("ignored_pending");
  }

  const record: WebhookSetupRecord = {
    sealed: sealNotionToken(token, keyMaterial),
    fingerprint,
    receivedAt: now.toISOString(),
    revealedAt: null,
  };
  const metadata = {
    ...((row.metadata as Record<string, unknown>) ?? {}),
    [METADATA_KEY]: record,
  };
  await prisma.integrationConnection.update({
    where: { id: row.id },
    data: { metadata: metadata as unknown as Prisma.InputJsonValue },
  });
  return log("captured");
}

export interface NotionWebhookSetupStatus {
  signingSecretConfigured: boolean;
  pending: {
    fingerprint: string;
    receivedAt: string;
    revealedAt: string | null;
  } | null;
}

/** Admin-only (notion:manage). Never returns the token. */
export async function getNotionWebhookSetupStatus(
  actor: AuthContext,
): Promise<NotionWebhookSetupStatus> {
  await assertPermission(actor, "notion:manage");
  const row = await prisma.integrationConnection.findUnique({
    where: { provider: "NOTION" },
    select: { metadata: true },
  });
  const setup = row ? readSetup(row.metadata) : null;
  return {
    signingSecretConfigured: Boolean(
      process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN,
    ),
    pending: setup
      ? {
          fingerprint: setup.fingerprint,
          receivedAt: setup.receivedAt,
          revealedAt: setup.revealedAt,
        }
      : null,
  };
}

export type RevealResult =
  | { status: "revealed"; token: string; fingerprint: string }
  | { status: "none" }
  | { status: "unreadable" };

/** Admin-only (notion:manage): returns the pending token so it can be copied into Notion and Vercel. Audited (fingerprint only). */
export async function revealNotionWebhookVerificationToken(
  actor: AuthContext,
): Promise<RevealResult> {
  await assertPermission(actor, "notion:manage");
  const keyMaterial = process.env.NOTION_API_KEY;
  const row = await prisma.integrationConnection.findUnique({
    where: { provider: "NOTION" },
    select: { id: true, metadata: true },
  });
  const setup = row ? readSetup(row.metadata) : null;
  if (!row || !setup) return { status: "none" };
  if (!keyMaterial) return { status: "unreadable" };

  let token: string;
  try {
    token = openNotionToken(setup.sealed, keyMaterial);
  } catch {
    return { status: "unreadable" };
  }
  const updated = { ...setup, revealedAt: new Date().toISOString() };
  await prisma.integrationConnection.update({
    where: { id: row.id },
    data: {
      metadata: {
        ...((row.metadata as Record<string, unknown>) ?? {}),
        [METADATA_KEY]: updated,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "integration.notion_webhook_token_revealed",
    entityType: "IntegrationConnection",
    entityId: row.id,
    afterState: { fingerprint: setup.fingerprint },
  });
  return { status: "revealed", token, fingerprint: setup.fingerprint };
}

/** Admin-only (notion:manage): removes the pending token after setup. Audited (fingerprint only). */
export async function clearNotionWebhookVerificationToken(
  actor: AuthContext,
): Promise<{ status: "cleared" | "none" }> {
  await assertPermission(actor, "notion:manage");
  const row = await prisma.integrationConnection.findUnique({
    where: { provider: "NOTION" },
    select: { id: true, metadata: true },
  });
  const setup = row ? readSetup(row.metadata) : null;
  if (!row || !setup) return { status: "none" };
  const rest = { ...((row.metadata as Record<string, unknown>) ?? {}) };
  delete rest[METADATA_KEY];
  await prisma.integrationConnection.update({
    where: { id: row.id },
    data: { metadata: rest as Prisma.InputJsonValue },
  });
  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "integration.notion_webhook_token_cleared",
    entityType: "IntegrationConnection",
    entityId: row.id,
    afterState: { fingerprint: setup.fingerprint },
  });
  return { status: "cleared" };
}
