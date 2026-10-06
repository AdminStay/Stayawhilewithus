import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store, audit } = vi.hoisted(() => ({
  store: {
    row: null as null | { id: string; metadata: Record<string, unknown> },
  },
  audit: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(async (_a: unknown, key: string) => {
    if (key !== "notion:manage") throw new Error("unexpected permission");
  }),
}));
vi.mock("@/platform/audit/record-audit", () => ({ recordAudit: audit }));
vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: {
      findUnique: vi.fn(async () => (store.row ? { ...store.row } : null)),
      update: vi.fn(
        async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
          store.row = { ...store.row!, metadata: data.metadata };
          return store.row;
        },
      ),
    },
  },
}));

import { assertPermission } from "@stayw/auth";

import {
  captureNotionWebhookVerificationToken,
  clearNotionWebhookVerificationToken,
  getNotionWebhookSetupStatus,
  notionTokenFingerprint,
  openNotionToken,
  revealNotionWebhookVerificationToken,
  sealNotionToken,
  SETUP_WINDOW_MS,
} from "./notion-webhook-setup.service";

const TOKEN = "secret_FAKE_test_verification_token_0123456789";
const admin = { userId: "admin-1" };

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  store.row = { id: "conn-notion", metadata: { other: "kept" } };
  process.env.NOTION_API_KEY = "fake-notion-key";
  delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

const loggedText = () =>
  JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

describe("sealing", () => {
  it("round-trips, differs per seal, and never contains the plaintext", () => {
    const a = sealNotionToken(TOKEN, "k");
    const b = sealNotionToken(TOKEN, "k");
    expect(JSON.stringify(a)).not.toContain(TOKEN);
    expect(a.data).not.toBe(b.data);
    expect(openNotionToken(a, "k")).toBe(TOKEN);
  });

  it("fails with the wrong key or a tampered ciphertext", () => {
    const sealed = sealNotionToken(TOKEN, "k");
    expect(() => openNotionToken(sealed, "other")).toThrow();
    expect(() =>
      openNotionToken(
        { ...sealed, data: Buffer.from("x").toString("base64") },
        "k",
      ),
    ).toThrow();
  });

  it("the fingerprint is short, stable and does not reveal the token", () => {
    const fp = notionTokenFingerprint(TOKEN);
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(notionTokenFingerprint(TOKEN)).toBe(fp);
    expect(TOKEN).not.toContain(fp);
  });
});

describe("captureNotionWebhookVerificationToken", () => {
  it("captures the first handshake sealed, keeps other metadata, and logs only the fingerprint", async () => {
    await expect(captureNotionWebhookVerificationToken(TOKEN)).resolves.toBe(
      "captured",
    );
    const setup = store.row!.metadata.webhookSetup as Record<string, unknown>;
    expect(store.row!.metadata.other).toBe("kept");
    expect(JSON.stringify(setup)).not.toContain(TOKEN);
    expect(setup.fingerprint).toBe(notionTokenFingerprint(TOKEN));
    expect(loggedText()).not.toContain(TOKEN);
    expect(loggedText()).toContain(notionTokenFingerprint(TOKEN));
  });

  it("ignores a second handshake inside the window (a stray POST can't replace the genuine token)", async () => {
    const now = new Date("2026-09-30T12:00:00Z");
    await captureNotionWebhookVerificationToken(TOKEN, now);
    await expect(
      captureNotionWebhookVerificationToken(
        "secret_ATTACKER",
        new Date(now.getTime() + 60_000),
      ),
    ).resolves.toBe("ignored_pending");
    const setup = store.row!.metadata.webhookSetup as { fingerprint: string };
    expect(setup.fingerprint).toBe(notionTokenFingerprint(TOKEN));
  });

  it("accepts a fresh handshake after the window (e.g. Notion 'Resend token')", async () => {
    const now = new Date("2026-09-30T12:00:00Z");
    await captureNotionWebhookVerificationToken(TOKEN, now);
    await expect(
      captureNotionWebhookVerificationToken(
        "secret_RESENT",
        new Date(now.getTime() + SETUP_WINDOW_MS + 1),
      ),
    ).resolves.toBe("captured");
  });

  it("does nothing once the signing secret is configured, without a NOTION row, or without NOTION_API_KEY", async () => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = "configured";
    await expect(captureNotionWebhookVerificationToken(TOKEN)).resolves.toBe(
      "already_configured",
    );
    delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
    store.row = null;
    await expect(captureNotionWebhookVerificationToken(TOKEN)).resolves.toBe(
      "no_connection_row",
    );
    delete process.env.NOTION_API_KEY;
    await expect(captureNotionWebhookVerificationToken(TOKEN)).resolves.toBe(
      "not_configured",
    );
    expect(loggedText()).not.toContain(TOKEN);
  });
});

describe("admin status / reveal / clear", () => {
  it("status never includes the token and needs notion:manage", async () => {
    await captureNotionWebhookVerificationToken(TOKEN);
    const status = await getNotionWebhookSetupStatus(admin as never);
    expect(assertPermission).toHaveBeenCalledWith(admin, "notion:manage");
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    expect(status).toMatchObject({
      signingSecretConfigured: false,
      pending: { revealedAt: null },
    });
  });

  it("reveal returns the token once to the admin and audits the fingerprint only", async () => {
    await captureNotionWebhookVerificationToken(TOKEN);
    const result = await revealNotionWebhookVerificationToken(admin as never);
    expect(result).toEqual({
      status: "revealed",
      token: TOKEN,
      fingerprint: notionTokenFingerprint(TOKEN),
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain(TOKEN);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.notion_webhook_token_revealed",
      }),
    );
    const status = await getNotionWebhookSetupStatus(admin as never);
    expect(status.pending?.revealedAt).not.toBeNull();
  });

  it("clear removes the token (other metadata kept) and audits the fingerprint only", async () => {
    await captureNotionWebhookVerificationToken(TOKEN);
    await expect(
      clearNotionWebhookVerificationToken(admin as never),
    ).resolves.toEqual({ status: "cleared" });
    expect(store.row!.metadata).toEqual({ other: "kept" });
    expect(JSON.stringify(audit.mock.calls)).not.toContain(TOKEN);
    await expect(
      revealNotionWebhookVerificationToken(admin as never),
    ).resolves.toEqual({ status: "none" });
  });

  it("a non-admin is refused before any read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      revealNotionWebhookVerificationToken({ userId: "ops" } as never),
    ).rejects.toThrow();
  });
});
