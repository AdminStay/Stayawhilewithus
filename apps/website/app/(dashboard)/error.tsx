"use client";

import { Button, Card } from "@stayw/ui";
import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";

/**
 * Catches uncaught errors from any dashboard route — most notably
 * ForbiddenError, thrown by every domain service's `assertPermission()`
 * call when a signed-in user has no role assigned yet (e.g. a brand new
 * Clerk sign-in that JIT-provisioned a User row with zero UserRole rows).
 * Without this boundary, that case crashed the whole page instead of
 * explaining what's wrong.
 *
 * The copy here is deliberately generic rather than assuming a permission
 * error specifically: Next.js redacts thrown-error messages in production
 * builds (only `digest` survives) for any Server Component/Action error,
 * not just this one, so this boundary has no reliable way to tell a
 * ForbiddenError apart from a validation failure or a database error once
 * deployed. Claiming "you need a role" for an unrelated error would be
 * actively misleading — see `packages/database/README.md` for how an
 * operator actually grants a role if that does turn out to be the cause.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <Card className="w-full">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-error-50 text-error-500">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold text-ink">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          This page couldn&apos;t load. If it keeps happening, it may be a
          permissions issue — ask a StayWhile administrator to check your
          account access.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-ink-faint">
            Reference: {error.digest}
          </p>
        )}
        <Button variant="secondary" className="mt-5 w-full" onClick={reset}>
          Try again
        </Button>
      </Card>
    </div>
  );
}
