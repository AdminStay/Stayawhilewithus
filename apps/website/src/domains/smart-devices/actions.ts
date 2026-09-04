"use server";

import type { AuthContext } from "@stayw/auth";
import { revalidatePath } from "next/cache";

import { fahrenheitToCelsius } from "./lib/temperature";
import {
  setNestCoolSetpointSchema,
  setNestFanSchema,
  setNestHeatCoolRangeSchema,
  setNestHeatSetpointSchema,
  setNestModeSchema,
} from "./schemas/nest-commands.schema";
import {
  mapProviderDeviceToPropertySchema,
  setProviderDeviceEnabledSchema,
  unmapProviderDeviceSchema,
} from "./schemas/provider-devices.schema";
import {
  logLockRefresh,
  refreshAugustTelemetry,
  type AugustRefreshResult,
} from "./services/lock-refresh.service";
import {
  sendNestThermostatCommand,
  type NestCommandResult,
} from "./services/nest-commands.service";
import {
  discoverAugustDevices,
  discoverNestDevices,
  mapProviderDeviceToProperty,
  setProviderDeviceEnabled,
  unmapProviderDevice,
  type DiscoverySyncResult,
} from "./services/provider-devices.service";
import {
  logThermostatRefresh,
  refreshThermostats,
  type ProviderRefreshOutcome,
} from "./services/thermostat-refresh.service";

export type { ProviderRefreshOutcome };

import { getCurrentUser } from "@/platform/auth/get-current-user";

const DEVICES_PAGE_PATH = "/integrations/devices";
const THERMOSTATS_PAGE_PATH = "/thermostats";
const LOCKS_PAGE_PATH = "/locks";

export type NestCommandActionState = { status: "idle" } | NestCommandResult;

/**
 * Mirrors SyncActionState (domains/integrations/actions.ts) exactly — same
 * three-state shape, same "the action itself never throws" contract, so a
 * real failure (missing credentials, RBAC denial, provider error) renders
 * inline via DiscoverDevicesButton instead of only being visible as the
 * page-level "Something went wrong" error boundary. `discovered` is the
 * exact count the discovery service call itself reported — never a
 * guessed/rounded value.
 */
export type DiscoverActionState =
  | { status: "idle" }
  | {
      status: "success";
      discovered: number;
      enriched?: number;
      detailFailures?: number;
    }
  | { status: "failure"; error: string };

/**
 * Shared body for the two provider-specific discovery actions below —
 * discovery itself (discoverNestDevices/discoverAugustDevices) and the
 * ProviderDevice upsert logic they call are completely unchanged by this;
 * this is purely the "catch and report" wrapper so a thrown error becomes
 * a renderable state instead of crashing to the page-level error boundary.
 * enriched/detailFailures are passed through only when the discover call
 * actually returned them (August's two-phase discovery) — Nest's discovery
 * never sets them, so they stay undefined and the button renders its plain
 * discovered-count message unchanged.
 */
async function runDiscovery(
  discover: (actor: AuthContext) => Promise<DiscoverySyncResult>,
): Promise<DiscoverActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await discover(actor);
    revalidatePath(DEVICES_PAGE_PATH);
    return {
      status: "success",
      discovered: result.discovered,
      enriched: result.enriched,
      detailFailures: result.detailFailures,
    };
  } catch (err) {
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function discoverNestDevicesAction(
  _prevState: DiscoverActionState,
): Promise<DiscoverActionState> {
  return runDiscovery(discoverNestDevices);
}

export async function discoverAugustDevicesAction(
  _prevState: DiscoverActionState,
): Promise<DiscoverActionState> {
  return runDiscovery(discoverAugustDevices);
}

export async function mapProviderDeviceToPropertyAction(formData: FormData) {
  const actor = await getCurrentUser();
  const input = mapProviderDeviceToPropertySchema.parse({
    providerDeviceId: formData.get("providerDeviceId"),
    propertyId: formData.get("propertyId"),
  });
  await mapProviderDeviceToProperty(actor, input);
  revalidatePath(DEVICES_PAGE_PATH);
}

export async function unmapProviderDeviceAction(formData: FormData) {
  const actor = await getCurrentUser();
  const input = unmapProviderDeviceSchema.parse({
    providerDeviceId: formData.get("providerDeviceId"),
  });
  await unmapProviderDevice(actor, input);
  revalidatePath(DEVICES_PAGE_PATH);
}

export async function setProviderDeviceEnabledAction(formData: FormData) {
  const actor = await getCurrentUser();
  const input = setProviderDeviceEnabledSchema.parse({
    providerDeviceId: formData.get("providerDeviceId"),
    enabled: formData.get("enabled") === "true",
  });
  await setProviderDeviceEnabled(actor, input);
  revalidatePath(DEVICES_PAGE_PATH);
  revalidatePath(THERMOSTATS_PAGE_PATH);
}

/**
 * Five thin command actions, one per control — each parses its own narrow
 * form shape, converts the display unit (Fahrenheit) to the SDM unit
 * (Celsius) where relevant, and hands off to the single real enforcement
 * point (sendNestThermostatCommand). None of these ever construct an SDM
 * command string themselves. Never throw for an expected rejection
 * (unsupported/unmapped/disabled/duplicate/provider-error) — those return
 * a discriminated NestCommandActionState the UI renders inline; an RBAC
 * failure still throws, same as every other permission check in this app.
 */
export async function setNestHeatSetpointAction(
  _prevState: NestCommandActionState,
  formData: FormData,
): Promise<NestCommandActionState> {
  const actor = await getCurrentUser();
  const input = setNestHeatSetpointSchema.parse({
    smartDeviceId: formData.get("smartDeviceId"),
    heatFahrenheit: Number(formData.get("heatFahrenheit")),
  });
  const result = await sendNestThermostatCommand(actor, {
    smartDeviceId: input.smartDeviceId,
    command: {
      type: "SET_HEAT",
      heatCelsius: fahrenheitToCelsius(input.heatFahrenheit),
    },
  });
  if (result.status === "success") revalidatePath(THERMOSTATS_PAGE_PATH);
  return result;
}

export async function setNestCoolSetpointAction(
  _prevState: NestCommandActionState,
  formData: FormData,
): Promise<NestCommandActionState> {
  const actor = await getCurrentUser();
  const input = setNestCoolSetpointSchema.parse({
    smartDeviceId: formData.get("smartDeviceId"),
    coolFahrenheit: Number(formData.get("coolFahrenheit")),
  });
  const result = await sendNestThermostatCommand(actor, {
    smartDeviceId: input.smartDeviceId,
    command: {
      type: "SET_COOL",
      coolCelsius: fahrenheitToCelsius(input.coolFahrenheit),
    },
  });
  if (result.status === "success") revalidatePath(THERMOSTATS_PAGE_PATH);
  return result;
}

export async function setNestHeatCoolRangeAction(
  _prevState: NestCommandActionState,
  formData: FormData,
): Promise<NestCommandActionState> {
  const actor = await getCurrentUser();
  const input = setNestHeatCoolRangeSchema.parse({
    smartDeviceId: formData.get("smartDeviceId"),
    heatFahrenheit: Number(formData.get("heatFahrenheit")),
    coolFahrenheit: Number(formData.get("coolFahrenheit")),
  });
  const result = await sendNestThermostatCommand(actor, {
    smartDeviceId: input.smartDeviceId,
    command: {
      type: "SET_RANGE",
      heatCelsius: fahrenheitToCelsius(input.heatFahrenheit),
      coolCelsius: fahrenheitToCelsius(input.coolFahrenheit),
    },
  });
  if (result.status === "success") revalidatePath(THERMOSTATS_PAGE_PATH);
  return result;
}

export async function setNestModeAction(
  _prevState: NestCommandActionState,
  formData: FormData,
): Promise<NestCommandActionState> {
  const actor = await getCurrentUser();
  const input = setNestModeSchema.parse({
    smartDeviceId: formData.get("smartDeviceId"),
    mode: formData.get("mode"),
  });
  const result = await sendNestThermostatCommand(actor, {
    smartDeviceId: input.smartDeviceId,
    command: { type: "SET_MODE", mode: input.mode },
  });
  if (result.status === "success") revalidatePath(THERMOSTATS_PAGE_PATH);
  return result;
}

export async function setNestFanAction(
  _prevState: NestCommandActionState,
  formData: FormData,
): Promise<NestCommandActionState> {
  const actor = await getCurrentUser();
  const durationMinutesRaw = formData.get("durationMinutes");
  const input = setNestFanSchema.parse({
    smartDeviceId: formData.get("smartDeviceId"),
    timerMode: formData.get("timerMode"),
    ...(durationMinutesRaw && { durationMinutes: Number(durationMinutesRaw) }),
  });
  const result = await sendNestThermostatCommand(actor, {
    smartDeviceId: input.smartDeviceId,
    command: {
      type: "SET_FAN",
      timerMode: input.timerMode,
      ...(input.durationMinutes != null && {
        durationSeconds: input.durationMinutes * 60,
      }),
    },
  });
  if (result.status === "success") revalidatePath(THERMOSTATS_PAGE_PATH);
  return result;
}

/**
 * Manual "Refresh" — /thermostats' own action, separate from
 * discoverNestDevicesAction/discoverAugustDevicesAction above (those stay
 * scoped to /integrations/devices' discovery flow). Read/fetch from
 * configured providers + write telemetry to StayWhile's DB only — never a
 * physical command, never a mapping change (see thermostat-refresh.service.ts
 * for the full read/write boundary). One provider failing is reported
 * alongside the other's real result, never silently dropped — this action
 * itself never throws for a provider-level failure (refreshThermostats()
 * already isolates those into the per-provider outcome array); it only
 * catches a genuinely unexpected top-level error (including an RBAC
 * denial), same "catch and report inline" convention as
 * discoverNestDevicesAction/discoverAugustDevicesAction above.
 */
export type RefreshThermostatsActionState =
  | { status: "idle" }
  | {
      status: "success";
      providers: ProviderRefreshOutcome[];
      refreshedAt: string;
    }
  | { status: "failure"; error: string };

export async function refreshThermostatsAction(
  _prevState: RefreshThermostatsActionState,
): Promise<RefreshThermostatsActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await refreshThermostats(actor);
    // Keeps the user on /thermostats and shows the newly refreshed DB state
    // without a manual reload — this page is a Server Component that reads
    // fresh on every render, so revalidating it is sufficient.
    revalidatePath(THERMOSTATS_PAGE_PATH);
    logThermostatRefresh("action_succeeded", { actorUserId: actor.userId });
    return {
      status: "success",
      providers: result.providers,
      refreshedAt: result.refreshedAt,
    };
  } catch (err) {
    // Covers both a genuine top-level failure inside refreshThermostats()
    // (e.g. an RBAC denial — the only thing it still lets throw) and
    // anything unexpected before it, e.g. getCurrentUser() itself failing.
    // Same message this action already returns to the browser — already
    // safe to log.
    logThermostatRefresh("action_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The single entry point behind /locks' "Refresh telemetry" button —
 * deliberately calls only refreshAugustTelemetry() (lock-refresh.service.ts),
 * never syncAugustDevices() (the separate, legacy /integrations "Sync Now"
 * mechanism, untouched by this action) and never discoverAugustDevices()/
 * mapProviderDeviceToProperty()/unmapProviderDevice()/
 * setProviderDeviceEnabled() (this file's own discovery/mapping actions
 * above, also untouched here). Same three-state, "never throws to the
 * caller" contract as refreshThermostatsAction above — a real failure
 * (missing August credentials, RBAC denial, provider error) renders inline
 * via RefreshLocksButton instead of only surfacing as the page-level error
 * boundary. refreshAugustTelemetry() itself already enforces
 * smart_devices:update — this action introduces no separate/broader
 * permission check.
 */
export type RefreshAugustActionState =
  | { status: "idle" }
  | ({ status: "success"; refreshedAt: string } & AugustRefreshResult)
  | { status: "failure"; error: string };

export async function refreshAugustAction(
  _prevState: RefreshAugustActionState,
): Promise<RefreshAugustActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await refreshAugustTelemetry(actor);
    // Keeps the user on /locks and shows the newly refreshed status,
    // battery, lock state, Last Synced, and Last Telemetry without a manual
    // reload — this page is a Server Component that reads fresh on every
    // render, so revalidating it is sufficient (same pattern
    // refreshThermostatsAction above uses for /thermostats).
    revalidatePath(LOCKS_PAGE_PATH);
    logLockRefresh("action_succeeded", { actorUserId: actor.userId });
    return {
      status: "success",
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
      refreshedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Covers both a genuine top-level failure inside refreshAugustTelemetry()
    // (e.g. an RBAC denial or missing August credentials) and anything
    // unexpected before it, e.g. getCurrentUser() itself failing. Same
    // message this action already returns to the browser — already safe to
    // log.
    logLockRefresh("action_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
