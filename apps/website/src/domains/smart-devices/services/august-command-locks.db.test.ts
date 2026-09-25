// Real-PostgreSQL regression test (2026-09-25 incident). Every other lock
// test mocks Prisma's transaction client, which is exactly how a `void`
// deserialization failure in `$queryRaw` shipped to Production unnoticed:
// a mock returns whatever it's told to. This file runs the real SQL against
// a real database instead.
//
// Where it runs:
//   - CI: always. The workflow provides a local Postgres service via
//     DATABASE_URL; if that is missing in CI, this file fails loudly rather
//     than skipping.
//   - Locally: when DATABASE_URL points at localhost/127.0.0.1; otherwise
//     skipped. It NEVER runs against a non-local host, so it cannot touch a
//     shared or Production database. Advisory locks write no table data.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient as PrismaClientType } from "@stayw/database";
import { afterAll, describe, expect, it } from "vitest";

import { acquireAugustCommandSlotsLock } from "./august-command-locks";

// Load @prisma/client through packages/database's own resolution. Importing
// "@stayw/database" at runtime would pull in its "server-only" guard, which
// Vitest can't mock inside an externalized CommonJS dependency.
const here = dirname(fileURLToPath(import.meta.url));
const requireFromDatabasePackage = createRequire(
  resolve(here, "../../../../../../packages/database/package.json"),
);
const { PrismaClient } = requireFromDatabasePackage("@prisma/client") as {
  PrismaClient: new (options: { datasourceUrl: string }) => PrismaClientType;
};

const url = process.env.DATABASE_URL ?? "";
const isLocalDb = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

if (process.env.CI && !isLocalDb) {
  throw new Error(
    "august-command-locks.db.test.ts must run in CI against the local Postgres service (DATABASE_URL on localhost).",
  );
}

describe.skipIf(!isLocalDb)(
  "August command raw SQL against real PostgreSQL",
  () => {
    const prisma = new PrismaClient({ datasourceUrl: url });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("documents the root cause: $queryRaw cannot deserialize pg_advisory_xact_lock()'s void result", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('august_command_slots_regression_probe'))`;
        }),
      ).rejects.toThrow(/deserialize column of type 'void'/);
    });

    it("acquireAugustCommandSlotsLock() — the exact SQL sendAugustLockCommand() runs — succeeds inside a real transaction", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await acquireAugustCommandSlotsLock(tx);
          return "ok";
        }),
      ).resolves.toBe("ok");
    });

    it("still serializes: a second transaction waits until the first one ends", async () => {
      const events: string[] = [];
      let releaseFirst!: () => void;
      const firstHolding = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstAcquired!: () => void;
      const firstHasLock = new Promise<void>((resolve) => {
        firstAcquired = resolve;
      });

      const first = prisma.$transaction(async (tx) => {
        await acquireAugustCommandSlotsLock(tx);
        events.push("first acquired");
        firstAcquired();
        await firstHolding;
        events.push("first releasing");
      });

      await firstHasLock;
      const second = prisma.$transaction(async (tx) => {
        await acquireAugustCommandSlotsLock(tx);
        events.push("second acquired");
      });

      // Give the second transaction time to reach (and block on) the lock.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(events).toEqual(["first acquired"]);

      releaseFirst();
      await Promise.all([first, second]);
      expect(events).toEqual([
        "first acquired",
        "first releasing",
        "second acquired",
      ]);
    });

    it("the per-device query's shape (boolean AS locked) deserializes fine with $queryRaw — unchanged by this fix", async () => {
      const rows = await prisma.$transaction(
        (tx) =>
          tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext('device_command'), hashtext(${"regression-probe-device"})) AS locked
          `,
      );
      expect(rows).toEqual([{ locked: true }]);
    });
  },
);
