import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertPermission } = vi.hoisted(() => ({
  mockAssertPermission: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@stayw/auth", () => ({ assertPermission: mockAssertPermission }));

import { getAugustTokenExpiry } from "./august-token-expiry.service";

const actor = { userId: "user-1" } as never;
const NOW = new Date("2026-11-15T00:00:00.000Z");

describe("getAugustTokenExpiry (2026-10-21)", () => {
  beforeEach(() => {
    mockAssertPermission.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("checks the caller's permission before reading the setting", async () => {
    mockAssertPermission.mockRejectedValueOnce(new Error("Forbidden"));
    vi.stubEnv("AUGUST_TOKEN_EXPIRES_AT", "2026-11-19T11:32:00Z");
    await expect(
      getAugustTokenExpiry(actor, "smart_devices:read", NOW),
    ).rejects.toThrow("Forbidden");
    expect(mockAssertPermission).toHaveBeenCalledWith(
      actor,
      "smart_devices:read",
    );
  });

  it("returns the parsed status from AUGUST_TOKEN_EXPIRES_AT", async () => {
    vi.stubEnv("AUGUST_TOKEN_EXPIRES_AT", "2026-11-19T11:32:00Z");
    await expect(
      getAugustTokenExpiry(actor, "integrations:read", NOW),
    ).resolves.toMatchObject({
      state: "expiring_soon",
      expiresAt: "2026-11-19T11:32:00.000Z",
    });
    expect(mockAssertPermission).toHaveBeenCalledWith(
      actor,
      "integrations:read",
    );
  });

  it("missing setting → not configured", async () => {
    vi.stubEnv("AUGUST_TOKEN_EXPIRES_AT", "");
    await expect(
      getAugustTokenExpiry(actor, "integrations:read", NOW),
    ).resolves.toEqual({ state: "not_configured", reason: "missing" });
  });

  it("never returns any credential, even when the credentials are set and the setting holds one by mistake", async () => {
    vi.stubEnv("AUGUST_ACCESS_TOKEN", "eyJ-test-access-token");
    vi.stubEnv("AUGUST_INSTALL_ID", "test-install-id-123");
    vi.stubEnv("AUGUST_IDENTIFIER", "email:ops@example.test");
    vi.stubEnv("AUGUST_TOKEN_EXPIRES_AT", "eyJ-test-access-token");
    const result = await getAugustTokenExpiry(actor, "integrations:read", NOW);
    expect(result).toEqual({ state: "not_configured", reason: "invalid" });
    expect(JSON.stringify(result)).not.toMatch(
      /eyJ-test-access-token|test-install-id-123|ops@example\.test/,
    );
  });
});
