// Real-PostgreSQL test for the NEST connection row lock (2026-10-28), in
// the same harness as august-command-locks.db.test.ts: mocked Prisma can't
// prove a lock blocks anything.
//
// Where it runs:
//   - CI: always, against the workflow's local Postgres service; if
//     DATABASE_URL isn't local in CI this file fails loudly.
//   - Locally: only when DATABASE_URL points at localhost/127.0.0.1;
//     otherwise skipped. It NEVER runs against a non-local host. It creates
//     the NEST integration_connections row only if it's missing, and
//     removes only a row it created.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient as PrismaClientType } from "@stayw/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lockNestConnectionRow } from "./nest-connection-row-lock";

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
    "nest-connection-row-lock.db.test.ts must run in CI against the local Postgres service (DATABASE_URL on localhost).",
  );
}

describe.skipIf(!isLocalDb)(
  "NEST connection row lock against real PostgreSQL",
  () => {
    const prisma = new PrismaClient({ datasourceUrl: url });
    let createdRowId: string | null = null;

    beforeAll(async () => {
      const existing = await prisma.integrationConnection.findUnique({
        where: { provider: "NEST" },
        select: { id: true },
      });
      if (!existing) {
        const row = await prisma.integrationConnection.create({
          data: { provider: "NEST", displayName: "Nest", authType: "OAUTH2" },
          select: { id: true },
        });
        createdRowId = row.id;
      }
    });

    afterAll(async () => {
      if (createdRowId) {
        await prisma.integrationConnection.delete({
          where: { id: createdRowId },
        });
      }
      await prisma.$disconnect();
    });

    it("runs inside a real transaction (nothing to deserialize)", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await lockNestConnectionRow(tx);
          return "ok";
        }),
      ).resolves.toBe("ok");
    });

    it("serializes: a second setter's transaction waits until the first commits, then sees its write", async () => {
      const events: string[] = [];
      let releaseFirst!: () => void;
      const firstHolding = new Promise<void>((r) => {
        releaseFirst = r;
      });
      let firstAcquired!: () => void;
      const firstHasLock = new Promise<void>((r) => {
        firstAcquired = r;
      });
      const marker = `row-lock-probe-${Date.now()}`;

      const first = prisma.$transaction(
        async (tx) => {
          await lockNestConnectionRow(tx);
          events.push("first locked");
          firstAcquired();
          await firstHolding;
          const row = await tx.integrationConnection.findUniqueOrThrow({
            where: { provider: "NEST" },
            select: { metadata: true },
          });
          await tx.integrationConnection.update({
            where: { provider: "NEST" },
            data: {
              metadata: {
                ...((row.metadata as Record<string, unknown>) ?? {}),
                rowLockProbe: marker,
              },
            },
          });
          events.push("first wrote");
        },
        { timeout: 15_000 },
      );

      await firstHasLock;
      const second = prisma.$transaction(
        async (tx) => {
          await lockNestConnectionRow(tx);
          events.push("second locked");
          const row = await tx.integrationConnection.findUniqueOrThrow({
            where: { provider: "NEST" },
            select: { metadata: true },
          });
          return (row.metadata as Record<string, unknown>).rowLockProbe;
        },
        { timeout: 15_000 },
      );

      await new Promise((r) => setTimeout(r, 300));
      expect(events).toEqual(["first locked"]);

      releaseFirst();
      const [, seen] = await Promise.all([first, second]);
      expect(events).toEqual(["first locked", "first wrote", "second locked"]);
      // The waiting setter re-reads AFTER the first committed — the merge
      // it writes can't drop the other setter's key.
      expect(seen).toBe(marker);

      // Clean up the probe key.
      await prisma.$transaction(async (tx) => {
        await lockNestConnectionRow(tx);
        const row = await tx.integrationConnection.findUniqueOrThrow({
          where: { provider: "NEST" },
          select: { metadata: true },
        });
        const { rowLockProbe: _probe, ...rest } =
          (row.metadata as Record<string, unknown>) ?? {};
        await tx.integrationConnection.update({
          where: { provider: "NEST" },
          data: { metadata: rest as never },
        });
      });
    });
  },
);
