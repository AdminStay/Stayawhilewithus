import "server-only";

import type { Prisma } from "@stayw/database";

/**
 * Row lock on the NEST IntegrationConnection (2026-10-28). Its `metadata`
 * holds both the Nest control switch (`thermostatControl`) and the
 * live-test list (`nestLiveTest`); each setter reads, merges and writes the
 * whole JSON. Taking this lock first, inside the setter's transaction,
 * makes a concurrent setter wait until this one commits — so it re-reads
 * the merged metadata instead of overwriting the other's change.
 *
 * $executeRaw (row count only), not $queryRaw: nothing to deserialize.
 * Pinned against real PostgreSQL in nest-connection-row-lock.db.test.ts.
 */
export async function lockNestConnectionRow(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT id FROM integration_connections WHERE provider = 'NEST' FOR UPDATE`;
}
