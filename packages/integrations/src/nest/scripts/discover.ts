/**
 * Real, read-only Nest discovery against the local dev database only.
 * Never touches production — DATABASE_URL/DIRECT_URL are loaded from
 * packages/database/.env (local Postgres), and Nest credentials from
 * apps/website/.env.local. Never prints any credential value.
 *
 * Mirrors discoverNestDevices() in
 * apps/website/src/domains/smart-devices/services/provider-devices.service.ts
 * exactly (same field separation — discovery only ever writes
 * externalDeviceId/discoveredName/deviceType/connectivityStatus/
 * rawMetadata/firstDiscoveredAt/lastSeenAt, never propertyId/enabled/
 * mappedAt/mappedByUserId/smartDeviceId). Uses a raw PrismaClient instead
 * of importing @stayw/database directly, since that package's client.ts
 * has a top-level `import "server-only"` guard that only resolves inside
 * Next.js's build (the "react-server" export condition) — this script
 * runs as a plain Node/tsx process outside that context.
 *
 *   pnpm --filter @stayw/integrations exec tsx src/nest/scripts/discover.ts
 *
 * Read-only against Google's SDM API (GET only, no write/command sent).
 * Writes ONLY to the local provider_devices table (upsert) plus bumping
 * the NEST integration_connections row's last_synced_at/status — never
 * touches smart_devices.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { NestClient, computeNestDeviceCapabilities } from "../client";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/integrations/src/nest/scripts -> repo root is 5 levels up.
const REPO_ROOT = resolve(__dirname, "../../../../..");

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (key && value !== undefined && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadEnvFile(resolve(REPO_ROOT, "packages/database/.env"));
  loadEnvFile(resolve(REPO_ROOT, "apps/website/.env.local"));

  const clientId = process.env.NEST_CLIENT_ID;
  const clientSecret = process.env.NEST_CLIENT_SECRET;
  const projectId = process.env.NEST_PROJECT_ID;
  const refreshToken = process.env.NEST_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !projectId || !refreshToken) {
    console.error(
      "Not configured: NEST_CLIENT_ID/NEST_CLIENT_SECRET/NEST_PROJECT_ID/NEST_REFRESH_TOKEN are missing from apps/website/.env.local.",
    );
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();

  try {
    console.log("Ensuring NEST integration_connections row exists...");
    const connection = await prisma.integrationConnection.upsert({
      where: { provider: "NEST" },
      update: {},
      create: {
        provider: "NEST",
        displayName: "Nest",
        authType: "OAUTH2",
        status: "DISCONNECTED",
      },
    });

    console.log("Fetching real devices from Google's SDM API...");
    const client = new NestClient({
      clientId,
      clientSecret,
      projectId,
      refreshToken,
    });
    const devices = await client.listDevices();

    console.log(`\nDiscovered ${devices.length} device(s).\n`);

    for (const device of devices) {
      const discoveredName =
        device.customName ?? device.roomName ?? device.externalDeviceId;

      await prisma.providerDevice.upsert({
        where: {
          integrationConnectionId_externalDeviceId: {
            integrationConnectionId: connection.id,
            externalDeviceId: device.externalDeviceId,
          },
        },
        update: {
          discoveredName,
          connectivityStatus: device.connectivity ?? "UNKNOWN",
          rawMetadata: device as never,
          lastSeenAt: new Date(),
        },
        create: {
          integrationConnectionId: connection.id,
          externalDeviceId: device.externalDeviceId,
          deviceType: "THERMOSTAT",
          discoveredName,
          connectivityStatus: device.connectivity ?? "UNKNOWN",
          rawMetadata: device as never,
        },
      });

      const capabilities = computeNestDeviceCapabilities(device.rawTraits);
      const modes: string[] = [];
      if (capabilities.supportsHeatSetpoint) modes.push("Heat");
      if (capabilities.supportsCoolSetpoint) modes.push("Cool");
      if (capabilities.hasFanTrait) modes.push("Fan");

      console.log(
        `  - "${discoveredName}" (${device.externalDeviceId}) — ${
          device.connectivity ?? "UNKNOWN"
        }, capabilities: ${modes.length > 0 ? modes.join("/") : "none reported yet"}${
          capabilities.ecoModeActive ? " [Eco active]" : ""
        }`,
      );
    }

    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date(), status: "CONNECTED" },
    });

    const [mapped, unmapped] = await Promise.all([
      prisma.providerDevice.count({
        where: {
          integrationConnectionId: connection.id,
          propertyId: { not: null },
        },
      }),
      prisma.providerDevice.count({
        where: { integrationConnectionId: connection.id, propertyId: null },
      }),
    ]);

    console.log(`\nMapped: ${mapped}. Unmapped: ${unmapped}.`);
    console.log(
      "\nNothing was mapped or enabled automatically — review at /integrations/devices once the app is running against this database.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
