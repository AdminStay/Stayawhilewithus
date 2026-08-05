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

  const created = await prisma.user.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      email: primaryEmail,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      avatarUrl: clerkUser.imageUrl,
    },
  });

  return { userId: created.id };
}
