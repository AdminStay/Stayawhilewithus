import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/smart-devices/services/lock-refresh.service", () => ({
  refreshAugustTelemetryAutomatic: vi.fn(),
}));

import { GET } from "./route";

import { refreshAugustTelemetryAutomatic } from "@/domains/smart-devices/services/lock-refresh.service";

function request(authHeader?: string): Request {
  return new Request(
    "https://stayawhilewithus-website.vercel.app/api/cron/august-lock-refresh",
    {
      headers: authHeader ? { authorization: authHeader } : {},
    },
  );
}

describe("GET /api/cron/august-lock-refresh", () => {
  const originalSecret = process.env.AUGUST_REFRESH_CRON_SECRET;
  const originalGeneralCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.mocked(refreshAugustTelemetryAutomatic)
      .mockReset()
      .mockResolvedValue({
        status: "completed",
        refreshed: 0,
        notReturnedByProvider: 0,
      });
  });

  afterEach(() => {
    process.env.AUGUST_REFRESH_CRON_SECRET = originalSecret;
    process.env.CRON_SECRET = originalGeneralCronSecret;
  });

  it("returns 503 and never runs the refresh when AUGUST_REFRESH_CRON_SECRET isn't configured — fails closed, same convention as the VA-schedule cron route", async () => {
    delete process.env.AUGUST_REFRESH_CRON_SECRET;

    const response = await GET(request("Bearer anything"));

    expect(response.status).toBe(503);
    expect(refreshAugustTelemetryAutomatic).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header at all", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(refreshAugustTelemetryAutomatic).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";

    const response = await GET(request("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(refreshAugustTelemetryAutomatic).not.toHaveBeenCalled();
  });

  it("DEDICATED-SECRET: rejects the general VA-schedule CRON_SECRET even if it happens to be set — this route only accepts its own AUGUST_REFRESH_CRON_SECRET", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";
    process.env.CRON_SECRET = "general-test-secret";

    const response = await GET(request("Bearer general-test-secret"));

    expect(response.status).toBe(401);
    expect(refreshAugustTelemetryAutomatic).not.toHaveBeenCalled();
  });

  it("accepts a request with the exact correct Bearer secret and calls refreshAugustTelemetryAutomatic exactly once, with no arguments (actor-agnostic)", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";

    const response = await GET(request("Bearer august-test-secret"));

    expect(response.status).toBe(200);
    expect(refreshAugustTelemetryAutomatic).toHaveBeenCalledTimes(1);
    expect(refreshAugustTelemetryAutomatic).toHaveBeenCalledWith();
  });

  it("does not call, check, or require any signed-in StayWhile user/session — the Bearer header is the entire authorization boundary", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";

    const response = await GET(request("Bearer august-test-secret"));

    expect(response.status).toBe(200);
  });

  it("returns the real result payload (status/refreshed/notReturnedByProvider) from a completed run", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";
    vi.mocked(refreshAugustTelemetryAutomatic).mockResolvedValueOnce({
      status: "completed",
      refreshed: 12,
      notReturnedByProvider: 1,
    });

    const response = await GET(request("Bearer august-test-secret"));
    const body = (await response.json()) as { ok: boolean; result: unknown };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      result: { status: "completed", refreshed: 12, notReturnedByProvider: 1 },
    });
  });

  it("still returns 200 (not an error) when the run reports already_running — that's an expected, handled outcome, not a failure", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";
    vi.mocked(refreshAugustTelemetryAutomatic).mockResolvedValueOnce({
      status: "already_running",
    });

    const response = await GET(request("Bearer august-test-secret"));

    expect(response.status).toBe(200);
  });

  it("returns 500, not an unhandled crash, if refreshAugustTelemetryAutomatic itself throws an unexpected error", async () => {
    process.env.AUGUST_REFRESH_CRON_SECRET = "august-test-secret";
    vi.mocked(refreshAugustTelemetryAutomatic).mockRejectedValueOnce(
      new Error("db down"),
    );

    const response = await GET(request("Bearer august-test-secret"));

    expect(response.status).toBe(500);
  });
});
