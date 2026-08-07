"use client";

import { useEffect } from "react";

/**
 * Catches uncaught errors from any dashboard route — most notably
 * ForbiddenError, thrown by every domain service's `assertPermission()`
 * call when a signed-in user has no role assigned yet (e.g. a brand new
 * Clerk sign-in that JIT-provisioned a User row with zero UserRole rows).
 * Without this boundary, that case crashed the whole page instead of
 * explaining what's wrong.
 */
export default function DashboardError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-gray-600">
        Your account isn&apos;t assigned a role yet, so it can&apos;t view this
        page. Ask a StayWhile administrator to grant you access.
      </p>
    </div>
  );
}
