import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";
import type { AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

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

  // A row for this email may already exist without being linked to this
  // Clerk id yet — most notably the bootstrap admin the seed script
  // creates (packages/database/prisma/seed.ts) with a placeholder
  // clerkUserId, before anyone has actually signed in as them. User.email
  // is unique, so blindly creating a new row here would throw a unique
  // constraint error instead of ever reaching that seeded row. Claim it by
  // relinking its clerkUserId instead — its existing UserRole assignments
  // (e.g. the seeded global "admin" role) carry over automatically since
  // it's the same row, not a new one.
  const byEmail = await prisma.user.findUnique({
    where: { email: primaryEmail },
  });
  if (byEmail) {
    const claimed = await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        clerkUserId,
        firstName: clerkUser.firstName ?? byEmail.firstName,
        lastName: clerkUser.lastName ?? byEmail.lastName,
        avatarUrl: clerkUser.imageUrl ?? byEmail.avatarUrl,
      },
    });
    return { userId: claimed.id };
  }

  const created = await prisma.user.create({
    data: {
      clerkUserId,
      email: primaryEmail,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      avatarUrl: clerkUser.imageUrl,
    },
  });

  return { userId: created.id };
}
