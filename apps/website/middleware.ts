import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Coarse authentication gate only — "must be signed in." Fine-grained
// authorization (permissions, property scoping) is enforced exclusively
// in the service layer (see packages/auth), never here.
export const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/health",
  // The VA/team schedule's automatic-refresh trigger (StayWhile's own n8n
  // instance, see app/api/cron/schedule-refresh/route.ts) has no Clerk
  // session — it's a scheduler, not a signed-in user — and authenticates
  // itself entirely via its own `Authorization: Bearer $CRON_SECRET` check.
  // Without this entry, auth.protect() below redirected every such request
  // to Clerk's hosted sign-in page before the route handler ever ran.
  "/api/cron(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
