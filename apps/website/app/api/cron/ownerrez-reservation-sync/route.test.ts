import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSyncAutomatic, mockHealth } = vi.hoisted(() => ({
  mockSyncAutomatic: vi.fn(),
  mockHealth: vi.fn(),
}));

vi.mock(
  "@/domains/reservations/services/ownerrez-reservation-sync.service",
  () => ({ syncOwnerRezReservationsAutomatic: mockSyncAutomatic }),
);
vi.mock("@/domains/reservations/services/ownerrez-sync-status.service", () => ({
  checkOwnerRezSyncHealthAndAlert: mockHealth,
}));

const { GET, maxDuration } = await import("./route");

const request = (authorization?: string) =>
  new Request("https://example.test/api/cron/ownerrez-reservation-sync", {
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret-value-for-tests";
  mockHealth.mockResolvedValue(null);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/ownerrez-reservation-sync", () => {
  it("503 when CRON_SECRET is not configured — nothing runs", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request("Bearer anything"));
    expect(res.status).toBe(503);
    expect(mockSyncAutomatic).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "Bearer wrong",
    "s3cret-value-for-tests",
    "bearer s3cret-value-for-tests",
  ])("401 for authorization=%s — nothing runs", async (header) => {
    const res = await GET(request(header));
    expect(res.status).toBe(401);
    expect(mockSyncAutomatic).not.toHaveBeenCalled();
    expect(mockHealth).not.toHaveBeenCalled();
  });

  it("kill switch off → 200 disabled, no health check", async () => {
    mockSyncAutomatic.mockResolvedValue({ status: "disabled" });
    const res = await GET(request("Bearer s3cret-value-for-tests"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "disabled" });
    expect(mockHealth).not.toHaveBeenCalled();
  });

  it("completed → counts only (no booking/guest details) + health check", async () => {
    mockSyncAutomatic.mockResolvedValue({
      status: "completed",
      created: 2,
      updated: 1,
      unchanged: 842,
      unmatchedProperty: [{ ownerRezBookingId: 1, propertyName: null }],
      unrecognizedStatus: [],
      nonGuest: {
        block: 190,
        quote_hold: 1,
        linked_availability: 1,
        owner: 0,
        unknown: 0,
      },
      guestErrors: [],
      guestDeferred: [],
      deferredUntil: null,
    });
    const res = await GET(request("Bearer s3cret-value-for-tests"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: "completed",
      summary: {
        created: 2,
        updated: 1,
        unchanged: 842,
        unmatchedProperty: 1,
        unrecognizedStatus: 0,
        guestErrors: 0,
        deferred: 0,
      },
    });
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: "cooldown", cooldownUntil: "2026-09-30T12:22:00Z" }],
    [{ status: "already_running" }],
    [{ status: "failed", reason: "network" }],
  ])(
    "handled outcome %j → 200 + health check (it may alert)",
    async (outcome) => {
      mockSyncAutomatic.mockResolvedValue(outcome);
      mockHealth.mockResolvedValue("consecutive_failures");
      const res = await GET(request("Bearer s3cret-value-for-tests"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        status: outcome.status,
        alert: "consecutive_failures",
      });
    },
  );

  it("unexpected error → 500 without details", async () => {
    mockSyncAutomatic.mockRejectedValue(new Error("secret db text"));
    const res = await GET(request("Bearer s3cret-value-for-tests"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
  });

  it("maxDuration 300 s", () => {
    expect(maxDuration).toBe(300);
  });

  it("uses no session/Clerk import — the bearer check is the whole boundary", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "./route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@clerk|get-current-user|getCurrentUser/);
  });
});
