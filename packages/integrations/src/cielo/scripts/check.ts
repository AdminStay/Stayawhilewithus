/**
 * Real, read-only Cielo connectivity check — no AC control, ever.
 *
 * Requires CIELO_USERNAME/CIELO_PASSWORD in apps/website/.env.local first.
 *
 *   pnpm --filter @stayw/integrations exec tsx src/cielo/scripts/check.ts
 *
 * Prints device names, MAC addresses, and online/offline — never the
 * password or any token.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CieloClient } from "../client";

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

  const username = process.env.CIELO_USERNAME;
  const password = process.env.CIELO_PASSWORD;

  if (!username || !password) {
    console.error(
      "Not configured: CIELO_USERNAME / CIELO_PASSWORD are missing from apps/website/.env.local.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new CieloClient({ username, password });

  console.log("Checking Cielo credentials...");
  const validation = await client.validateCredentials();
  if (!validation.valid) {
    console.error(`Login failed: ${validation.reason}`);
    console.error(
      "If this says invalid credentials, confirm you can log into https://home.cielowigle.com/ with this exact email/password first — that's the account this integration authenticates against.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("Login succeeded.\n");

  console.log("Fetching devices...");
  const devices = await client.listDevices();

  if (devices.length === 0) {
    console.log("Account has no devices visible to this login.");
    return;
  }

  console.log(`Found ${devices.length} device(s):\n`);
  for (const device of devices) {
    console.log(
      `  - "${device.name}" (macAddress: ${device.id}) — ${device.online ? "ONLINE" : "OFFLINE"}`,
    );
  }

  const firstDevice = devices[0];
  if (firstDevice) {
    console.log(
      "\nTo associate these with StayWhile properties, set CIELO_PROPERTY_MAP in apps/website/.env.local using the MAC addresses above, e.g.:",
    );
    console.log(
      `  CIELO_PROPERTY_MAP='{"${firstDevice.id}":"<property-id-from-your-database>"}'`,
    );
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
