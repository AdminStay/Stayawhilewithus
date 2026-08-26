import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";
import type { AuthContext } from "@stayw/auth";
import { prisma, type User } from "@stayw/database";

import { AccountDeactivatedError } from "@/platform/errors";
import { applyPendingRoleFromInvitation } from "@/platform/identity/sync-clerk-user";

/** Blocks a DEACTIVATED (or soft-deleted) row at the authentication boundary — before any assertPermission call runs, so it's enforced uniformly across every route/action with one check. */
function assertActive(user: Pick<User, "status" | "deletedAt">): void {
  if (user.status !== "ACTIVE" || user.deletedAt) {
    throw new AccountDeactivatedError();
  }
}

/**
 * Resolves the signed-in Clerk user to our internal User row and returns
 * an AuthContext for RBAC checks. Primary path is the Clerk webhook sync
 * (see src/platform/identity/), this JIT fallback provisions the row on
 * the fly if a webhook hasn't landed yet, so no request fails purely due
 * to webhook delivery timing.
 */
export async function getCurrentUser(): Promise<AuthContext> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    throw new Error(
      "getCurrentUser() called outside an authenticated request.",
    );
  }

  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) {
    assertActive(existing);
    return { userId: existing.id };
  }

  const clerkUser = await (await clerkClient()).users.getUser(clerkUserId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId,
  )?.emailAddress;
  if (!primaryEmail) {
    throw new Error(
      `Clerk user "${clerkUserId}" has no primary email address.`,
    );
  }
  // Emails are always compared/stored lowercased so "Admin@x.com" and
  // "admin@x.com" can never become two different application users —
  // User.email's unique constraint is case-sensitive at the database
  // level, so this normalization is what actually makes it behave as a
  // case-insensitive key in practice.
  const normalizedEmail = primaryEmail.toLowerCase();

  // A row for this email may already exist without being linked to this
  // Clerk id yet — most notably the bootstrap admin the seed script
  // creates (packages/database/prisma/seed.ts) with a placeholder
  // clerkUserId, before anyone has actually signed in as them. User.email
  // is unique, so blindly creating a new row here would throw a unique
  // constraint error instead of ever reaching that seeded row. Claim it by
  // relinking its clerkUserId instead — its existing UserRole assignments
  // (e.g. the seeded global "admin" role) carry over automatically since
  // it's the same row, not a new one. findFirst + mode:"insensitive" (not
  // findUnique) so a differently-cased match still claims the same row.
  const byEmail = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
  });
  if (byEmail) {
    const claimed = await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        clerkUserId,
        email: normalizedEmail,
        firstName: clerkUser.firstName ?? byEmail.firstName,
        lastName: clerkUser.lastName ?? byEmail.lastName,
        avatarUrl: clerkUser.imageUrl ?? byEmail.avatarUrl,
      },
    });
    assertActive(claimed);
    return { userId: claimed.id };
  }

  const created = await prisma.user.create({
    data: {
      clerkUserId,
      email: normalizedEmail,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      avatarUrl: clerkUser.imageUrl,
    },
  });
  // Mirrors sync-clerk-user.ts's webhook path — this JIT-provisioning path
  // creates the same "brand new User row" moment when a webhook hasn't
  // landed yet, so the pending role selected at invite time (if any) must
  // be applied here too, not just in the webhook handler.
  await applyPendingRoleFromInvitation(created.id, clerkUser.publicMetadata);

  return { userId: created.id };
}
