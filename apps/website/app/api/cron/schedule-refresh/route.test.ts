import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/team/services/schedule.service", () => ({
  runScheduleSync: vi.fn(),
}));

import { GET } from "./route";

import { runScheduleSync } from "@/domains/team/services/schedule.service";

function request(authHeader?: string): Request {
  return new Request(
    "https://stayawhilewithus-website.vercel.app/api/cron/schedule-refresh",
    {
      headers: authHeader ? { authorization: authHeader } : {},
    },
  );
}

describe("GET /api/cron/schedule-refresh", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.mocked(runScheduleSync).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("returns 503 and never runs the sync when CRON_SECRET isn't configured — fails closed, same convention as the Notion webhook route", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request("Bearer anything"));

    expect(response.status).toBe(503);
    expect(runScheduleSync).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header at all", async () => {
    process.env.CRON_SECRET = "test-secret";

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runScheduleSync).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    process.env.CRON_SECRET = "test-secret";

    const response = await GET(request("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(runScheduleSync).not.toHaveBeenCalled();
  });

  it("accepts a request with the exact correct Bearer secret and calls runScheduleSync exactly once", async () => {
    process.env.CRON_SECRET = "test-secret";

    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(runScheduleSync).toHaveBeenCalledTimes(1);
    expect(runScheduleSync).toHaveBeenCalledWith();
  });

  it("does not call, check, or require any signed-in StayWhile user/session — the Bearer header is the entire authorization boundary", async () => {
    process.env.CRON_SECRET = "test-secret";

    // No Clerk/auth mock is set up anywhere in this file, and the route
    // module imports no auth/session helper at all (only
    // schedule.service.ts's runScheduleSync, mocked above) — a successful
    // call with zero actor-related setup is itself the proof.
    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
  });

  it("returns 500, not an unhandled crash, if runScheduleSync itself throws an unexpected error", async () => {
    process.env.CRON_SECRET = "test-secret";
    vi.mocked(runScheduleSync).mockRejectedValueOnce(new Error("db down"));

    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(500);
  });
});
