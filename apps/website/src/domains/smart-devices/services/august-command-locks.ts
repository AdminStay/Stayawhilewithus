import "server-only";

import type { Prisma } from "@stayw/database";

/**
 * Account-wide transaction lock that serializes sendAugustLockCommand()'s
 * in-flight command count across concurrent requests for different locks.
 * Held until the surrounding transaction ends.
 *
 * `pg_advisory_xact_lock()` returns `void`, which Prisma's `$queryRaw` cannot
 * deserialize ("Failed to deserialize column of type 'void'"). Using it there
 * made every lock command in Production throw before any audit write or
 * August call (2026-09-25 incident). `$executeRaw` runs the same statement
 * without reading a result. Exported on its own so a real-PostgreSQL test
 * (august-command-locks.db.test.ts) exercises this exact SQL.
 */
export async function acquireAugustCommandSlotsLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('august_command_slots'))`;
}
