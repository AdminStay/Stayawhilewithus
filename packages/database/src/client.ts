import "server-only";

import { PrismaClient } from "@prisma/client";

declare global {
  var __stayWhilePrisma: PrismaClient | undefined;
}

/**
 * Singleton PrismaClient. Reused across hot reloads in dev to avoid
 * exhausting the Postgres connection pool. Only ever import this from
 * server-side code (enforced by the "server-only" import above).
 */
export const prisma = globalThis.__stayWhilePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__stayWhilePrisma = prisma;
}

export * from "@prisma/client";
