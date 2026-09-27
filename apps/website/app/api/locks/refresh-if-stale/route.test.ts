import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ForbiddenError } from "@stayw/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockIfStale, mockFreshness } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockIfStale: vi.fn(),
  mockFreshness: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: mockGetCurrentUser,
}));
vi.mock("@stayw/auth", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/domains/smart-devices/services/lock-refresh.service", () => ({
  refreshAugustTelemetryIfStale: mockIfStale,
  getAugustRefreshFreshness: mockFreshness,
}));

import { maxDuration, POST } from "./route";

const actor = { userId: "viewer-1" };

describe("POST /api/locks/refresh-if-stale (2026-09-27 refresh-on-view)", () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset().mockResolvedValue(actor);
    mockIfStale.mockReset().mockResolvedValue({ status: "fresh" });
    mockFreshness.mockReset().mockResolvedValue({
      lastSucceededAt: "2026-09-27T20:00:00.000Z",
      cooldownUntil: null,
    });
  });

  it("asks the gated service as the signed-in user and returns only status + freshness", async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "fresh",
      lastSucceededAt: "2026-09-27T20:00:00.000Z",
      cooldownUntil: null,
    });
    expect(mockIfStale).toHaveBeenCalledTimes(1);
    expect(mockIfStale).toHaveBeenCalledWith(actor);
  });

  it("passes through cooldown without calling anything else", async () => {
    mockIfStale.mockResolvedValue({
      status: "cooldown",
      cooldownUntil: "2026-09-27T20:30:00.000Z",
    });
    const res = await POST();
    expect((await res.json()).status).toBe("cooldown");
  });

  it("returns 403 when the user can't view smart devices", async () => {
    mockIfStale.mockRejectedValue(new ForbiddenError("smart_devices:read"));
    // (ForbiddenError is the mocked class the route itself imports.)
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it("returns 500 (sanitized) on an unexpected error, e.g. no session", async () => {
    mockGetCurrentUser.mockRejectedValue(new Error("no session"));
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    expect(mockIfStale).not.toHaveBeenCalled();
  });

  it("allows up to 300 s, since the page's own 60 s limit is too short for a worst-case fleet refresh", () => {
    expect(maxDuration).toBe(300);
  });

  it("SAFETY: the route reads no request body and can't reach any lock command, PIN, reset or hold path", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "./route.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(
      /request\.json|august-commands|sendAugustLockCommand|operate|ADMIN_RESET|resetAugustLock|OperationalHold|pin|accessCode/i,
    );
  });
});
