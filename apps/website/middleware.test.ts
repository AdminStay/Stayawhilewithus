import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isPublicRoute } from "./middleware";

// createRouteMatcher reads `req.nextUrl.pathname` — a plain Request has no
// `nextUrl`, so this must be a real NextRequest, not a Request.
function requestFor(path: string) {
  return new NextRequest(
    new URL(path, "https://stayawhilewithus-website.vercel.app"),
  );
}

describe("isPublicRoute", () => {
  it("treats the cron schedule-refresh route as public — it authenticates via its own CRON_SECRET check, not a Clerk session", () => {
    expect(isPublicRoute(requestFor("/api/cron/schedule-refresh"))).toBe(true);
  });

  it("still treats the existing webhook and health routes as public (unchanged)", () => {
    expect(isPublicRoute(requestFor("/api/webhooks/clerk"))).toBe(true);
    expect(isPublicRoute(requestFor("/api/webhooks/notion"))).toBe(true);
    expect(isPublicRoute(requestFor("/api/health"))).toBe(true);
  });

  it("still treats sign-in/sign-up as public (unchanged)", () => {
    expect(isPublicRoute(requestFor("/sign-in"))).toBe(true);
    expect(isPublicRoute(requestFor("/sign-up"))).toBe(true);
  });

  it("does NOT treat dashboard or other application/API routes as public — they must still require a Clerk session", () => {
    expect(isPublicRoute(requestFor("/dashboard"))).toBe(false);
    expect(isPublicRoute(requestFor("/team"))).toBe(false);
    expect(isPublicRoute(requestFor("/api/properties"))).toBe(false);
    expect(isPublicRoute(requestFor("/api/integrations"))).toBe(false);
  });
});
