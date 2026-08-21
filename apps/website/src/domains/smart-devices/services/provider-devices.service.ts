import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma, type ProviderDevice } from "@stayw/database";
import type {
  IntegrationProvider,
  SmartDeviceProvider,
} from "@stayw/database/enums";
import { NestClient, type NestDevice } from "@stayw/integrations/nest";

export type { ProviderDevice };

import { celsiusToFahrenheit } from "../lib/temperature";
import {
  mapProviderDeviceToPropertySchema,
  setProviderDeviceEnabledSchema,
  unmapProviderDeviceSchema,
  type MapProviderDeviceToPropertyInput,
  type SetProviderDeviceEnabledInput,
  type UnmapProviderDeviceInput,
} from "../schemas/provider-devices.schema";

import { ensureConnectionRows } from "@/domains/integrations/services/integrations.service";
import { recordAudit } from "@/platform/audit/record-audit";

export interface DiscoverySyncResult {
  discovered: number;
}

/**
 * Only IntegrationProviders that are also real SmartDeviceProvider values
 * (a strict subset — IntegrationProvider also covers non-device providers
 * like OwnerRez/Slack) can ever back a SmartDevice row. Deliberately a
 * narrow allowlist, not a blanket cast, so a future non-device provider
 * added to IntegrationProvider can't silently "become" a smart device.
 * Note: SmartDeviceProvider also has HONEYWELL, but IntegrationProvider
 * currently doesn't — a pre-existing enum gap, not something this change
 * introduces or fixes; omitted here rather than guessed at.
 */
const SMART_DEVICE_PROVIDERS: Partial<
  Record<IntegrationProvider, SmartDeviceProvider>
> = {
  NEST: "NEST",
  AUGUST: "AUGUST",
  CIELO: "CIELO",
  YALE: "YALE",
  ECOBEE: "ECOBEE",
};

/**
 * Maps a discovered NestDevice's parsed SDM fields onto the exact
 * SmartDevice.metadata keys the dashboard's existing provider-agnostic
 * accessors already read (getCurrentTemperature/getTargetTemperature/
 * getMode/getHumidity/getTelemetryUpdatedAt — see smart-devices.service.ts)
 * — this is what makes Nest appear on /thermostats with zero UI changes.
 * Only ever sets a key when the source field is actually present; SDM
 * setpoints are Celsius-only, converted to Fahrenheit here for display
 * only — ProviderDevice.rawMetadata keeps the untouched Celsius/raw-trait
 * data for any future command payload, which must stay Celsius per SDM.
 * Exported for reuse by nest-commands.service.ts, which applies this same
 * mapping to a post-command *confirmed* device read — never to a guessed
 * value (see that file's module doc comment).
 *
 * `observedAt` must be the real moment this specific `device` snapshot was
 * actually obtained from Nest — never defaulted to "now" internally. The
 * SDM API itself doesn't expose a per-device telemetry timestamp (see
 * RawSdmDevice in packages/integrations/src/nest/types.ts — no updateTime
 * field), so callers pass the best honest proxy they have: a fresh
 * post-command client.getDevice() read can honestly pass `new Date()`
 * (it just happened); a discovery snapshot being copied out later (e.g.
 * setProviderDeviceEnabled(), below) must pass that snapshot's own
 * ProviderDevice.lastSeenAt instead — otherwise enabling a device would
 * silently claim an old reading is fresh.
 */
export function toSmartDeviceMetadata(
  device: NestDevice,
  observedAt: Date,
): Record<string, unknown> {
  const targetCelsius = device.heatCelsius ?? device.coolCelsius;

  return {
    ...(device.ambientTemperatureCelsius != null && {
      currentTemperature: celsiusToFahrenheit(device.ambientTemperatureCelsius),
    }),
    ...(targetCelsius != null && {
      targetTemperature: celsiusToFahrenheit(targetCelsius),
    }),
    ...(device.thermostatMode != null && { mode: device.thermostatMode }),
    ...(device.ambientHumidityPercent != null && {
      humidity: device.ambientHumidityPercent,
    }),
    telemetryUpdatedAt: observedAt.toISOString(),
  };
}

/**
 * Discovery-only: upserts every device Nest's real API reports into the
 * ProviderDevice staging table, keyed on [integrationConnectionId,
 * externalDeviceId]. NEVER touches propertyId/enabled/mappedAt/
 * mappedByUserId/smartDeviceId — those are exclusively admin-controlled,
 * written only via mapProviderDeviceToProperty()/setProviderDeviceEnabled()
 * below. No property mapping happens here, no NEST_PROPERTY_MAP, no
 * name-based guessing — every discovered device starts life Unmapped.
 */
export async function discoverNestDevices(
  actor: AuthContext,
): Promise<DiscoverySyncResult> {
  await assertPermission(actor, "smart_devices:update");

  const clientId = process.env.NEST_CLIENT_ID;
  const clientSecret = process.env.NEST_CLIENT_SECRET;
  const projectId = process.env.NEST_PROJECT_ID;
  const refreshToken = process.env.NEST_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !projectId || !refreshToken) {
    throw new Error(
      "Nest isn't configured yet — set NEST_CLIENT_ID/NEST_CLIENT_SECRET/NEST_PROJECT_ID/NEST_REFRESH_TOKEN (see packages/integrations/src/nest/README.md).",
    );
  }

  await ensureConnectionRows();
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { provider: "NEST" },
  });

  const client = new NestClient({
    clientId,
    clientSecret,
    projectId,
    refreshToken,
  });
  const devices = await client.listDevices();

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
        rawMetadata: device as unknown as Prisma.InputJsonValue,
        lastSeenAt: new Date(),
      },
      create: {
        integrationConnectionId: connection.id,
        externalDeviceId: device.externalDeviceId,
        deviceType: "THERMOSTAT",
        discoveredName,
        connectivityStatus: device.connectivity ?? "UNKNOWN",
        rawMetadata: device as unknown as Prisma.InputJsonValue,
      },
    });
  }

  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { lastSyncedAt: new Date(), status: "CONNECTED" },
  });

  return { discovered: devices.length };
}

export async function listDiscoveredDevices(
  actor: AuthContext,
  opts?: { provider?: IntegrationProvider },
) {
  await assertPermission(actor, "smart_devices:read");
  return prisma.providerDevice.findMany({
    where: opts?.provider
      ? { integrationConnection: { provider: opts.provider } }
      : undefined,
    include: {
      property: true,
      integrationConnection: true,
      mappedByUser: true,
    },
    orderBy: [{ enabled: "asc" }, { discoveredName: "asc" }],
  });
}

/**
 * Explicit, human-confirmed mapping only — never inferred from device
 * name. Does not enable the device; mapping and enabling are deliberately
 * separate actions (see setProviderDeviceEnabled()).
 */
export async function mapProviderDeviceToProperty(
  actor: AuthContext,
  rawInput: MapProviderDeviceToPropertyInput,
): Promise<ProviderDevice> {
  await assertPermission(actor, "smart_devices:update");
  const input = mapProviderDeviceToPropertySchema.parse(rawInput);

  const property = await prisma.property.findUnique({
    where: { id: input.propertyId },
  });
  if (!property || property.deletedAt) {
    throw new Error("Property not found.");
  }

  const updated = await prisma.providerDevice.update({
    where: { id: input.providerDeviceId },
    data: {
      propertyId: input.propertyId,
      mappedAt: new Date(),
      mappedByUserId: actor.userId,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "provider_device.mapped",
    entityType: "ProviderDevice",
    entityId: updated.id,
    afterState: updated,
  });

  return updated;
}

/**
 * Clears mapping/enabled state and detaches the SmartDeviceId link.
 * Deliberately does NOT touch the SmartDevice row itself — there's no
 * SmartDevice.deactivatedAt field yet (a known, separate gap — see
 * HANDOFF.md), so a previously-enabled device's SmartDevice row is left
 * exactly as last synced rather than silently deleted. It simply stops
 * being linked to a live ProviderDevice mapping until remapped.
 */
export async function unmapProviderDevice(
  actor: AuthContext,
  rawInput: UnmapProviderDeviceInput,
): Promise<ProviderDevice> {
  await assertPermission(actor, "smart_devices:update");
  const input = unmapProviderDeviceSchema.parse(rawInput);

  const updated = await prisma.providerDevice.update({
    where: { id: input.providerDeviceId },
    data: {
      propertyId: null,
      enabled: false,
      mappedAt: null,
      mappedByUserId: null,
      smartDeviceId: null,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "provider_device.unmapped",
    entityType: "ProviderDevice",
    entityId: updated.id,
    afterState: updated,
  });

  return updated;
}

/**
 * Enabling requires an existing property mapping and creates/updates the
 * real SmartDevice row (upsert on [provider, externalDeviceId], same
 * unique key every other provider's sync already uses, so re-enabling is
 * idempotent) — this is the one place a Nest device becomes visible on
 * /thermostats. Disabling only flips the flag; per unmapProviderDevice()'s
 * note above, an already-created SmartDevice row isn't retroactively
 * removed. Transactional so the ProviderDevice/SmartDevice pair never goes
 * out of sync with each other.
 */
export async function setProviderDeviceEnabled(
  actor: AuthContext,
  rawInput: SetProviderDeviceEnabledInput,
): Promise<ProviderDevice> {
  await assertPermission(actor, "smart_devices:update");
  const input = setProviderDeviceEnabledSchema.parse(rawInput);

  const providerDevice = await prisma.providerDevice.findUniqueOrThrow({
    where: { id: input.providerDeviceId },
    include: { integrationConnection: true },
  });

  if (input.enabled && !providerDevice.propertyId) {
    throw new Error("Map this device to a property before enabling it.");
  }

  const smartDeviceProvider =
    SMART_DEVICE_PROVIDERS[providerDevice.integrationConnection.provider];
  if (input.enabled && !smartDeviceProvider) {
    throw new Error(
      `${providerDevice.integrationConnection.provider} is not a smart-device provider.`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.enabled && smartDeviceProvider && providerDevice.propertyId) {
      const rawMetadata = providerDevice.rawMetadata as unknown as NestDevice;
      const smartDeviceData = {
        propertyId: providerDevice.propertyId,
        name: providerDevice.discoveredName,
        status: providerDevice.connectivityStatus,
        // lastSeenAt, not "now" — this metadata is copied from an existing
        // discovery snapshot, not a fresh read (enabling makes zero Nest
        // API calls). Passing the real snapshot time keeps /thermostats'
        // "Last telemetry" column honest instead of claiming a reading
        // taken at discovery time is fresh at enable time.
        metadata: toSmartDeviceMetadata(
          rawMetadata,
          providerDevice.lastSeenAt,
        ) as Prisma.InputJsonValue,
      };

      const smartDevice = await tx.smartDevice.upsert({
        where: {
          provider_externalDeviceId: {
            provider: smartDeviceProvider,
            externalDeviceId: providerDevice.externalDeviceId,
          },
        },
        update: smartDeviceData,
        create: {
          ...smartDeviceData,
          provider: smartDeviceProvider,
          deviceType: providerDevice.deviceType,
          externalDeviceId: providerDevice.externalDeviceId,
        },
      });

      return tx.providerDevice.update({
        where: { id: providerDevice.id },
        data: { enabled: true, smartDeviceId: smartDevice.id },
      });
    }

    return tx.providerDevice.update({
      where: { id: providerDevice.id },
      data: { enabled: false },
    });
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: input.enabled
      ? "provider_device.enabled"
      : "provider_device.disabled",
    entityType: "ProviderDevice",
    entityId: updated.id,
    afterState: updated,
  });

  return updated;
}
