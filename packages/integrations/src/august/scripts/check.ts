/**
 * Real, read-only August connectivity check — no lock/unlock, ever.
 *
 * Run locally after src/august/scripts/login.ts has written
 * AUGUST_IDENTIFIER/AUGUST_INSTALL_ID/AUGUST_ACCESS_TOKEN into
 * apps/website/.env.local:
 *
 *   pnpm --filter @stayw/integrations exec tsx src/august/scripts/check.ts
 *
 * Prints lock names, house IDs, connectivity (ONLINE/OFFLINE/UNKNOWN — see
 * AugustLockDetail's doc comment in ../types.ts for what UNKNOWN means),
 * and battery % — never the access token or any other credential.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AugustClient } from "../client";
import { isAugustBrand } from "../types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL_PATH = resolve(
  __dirname,
  "../../../../../apps/website/.env.local",
);

function loadEnvLocal(): void {
  if (!existsSync(ENV_LOCAL_PATH)) return;
  const content = readFileSync(ENV_LOCAL_PATH, "utf8");
  for (const line of content.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const identifier = process.env.AUGUST_IDENTIFIER;
  const installId = process.env.AUGUST_INSTALL_ID;
  const accessToken = process.env.AUGUST_ACCESS_TOKEN;
  const brand = process.env.AUGUST_BRAND;

  if (!identifier || !installId || !accessToken) {
    console.error(
      "Not configured: AUGUST_IDENTIFIER / AUGUST_INSTALL_ID / AUGUST_ACCESS_TOKEN are missing from apps/website/.env.local.",
    );
    console.error(
      "Run: pnpm --filter @stayw/integrations exec tsx src/august/scripts/login.ts",
    );
    process.exitCode = 1;
    return;
  }

  const client = new AugustClient({
    identifier,
    installId,
    accessToken,
    brand: brand && isAugustBrand(brand) ? brand : "august",
  });

  console.log("Checking August credentials...");
  const validation = await client.validateCredentials();
  if (!validation.valid) {
    console.error(`Credential check failed: ${validation.reason}`);
    console.error(
      "The access token has likely expired — re-run the login script (it will reuse the saved installId and skip the verification-code step).",
    );
    process.exitCode = 1;
    return;
  }
  console.log("Credentials are valid.\n");

  console.log("Fetching locks...");
  const locks = await client.listLocks();

  if (locks.length === 0) {
    console.log("Account has no locks visible to this login.");
    return;
  }

  console.log(`Found ${locks.length} lock(s):\n`);
  for (const lock of locks) {
    const detail = await client.getLockDetail(lock.id);
    const batteryText =
      detail.batteryLevel !== null
        ? `${detail.batteryLevel}% battery`
        : "no battery reading";
    console.log(
      `  - "${detail.name}" (id: ${detail.id}, houseId: ${detail.houseId}) — ${detail.connectivity}, ${batteryText}`,
    );
  }

  const firstLock = locks[0];
  if (firstLock) {
    console.log(
      "\nTo associate these with StayWhile properties, set AUGUST_PROPERTY_MAP in apps/website/.env.local using the houseId values above, e.g.:",
    );
    console.log(
      `  AUGUST_PROPERTY_MAP='{"${firstLock.houseId}":"<property-id-from-your-database>"}'`,
    );
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
