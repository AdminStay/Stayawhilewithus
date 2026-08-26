"use server";

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
  sendNestThermostatCommand,
  type NestCommandResult,
} from "./services/nest-commands.service";
import {
  discoverAugustDevices,
  discoverNestDevices,
  mapProviderDeviceToProperty,
  setProviderDeviceEnabled,
  unmapProviderDevice,
} from "./services/provider-devices.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

const DEVICES_PAGE_PATH = "/integrations/devices";
const THERMOSTATS_PAGE_PATH = "/thermostats";

export type NestCommandActionState = { status: "idle" } | NestCommandResult;

export async function discoverNestDevicesAction() {
  const actor = await getCurrentUser();
  await discoverNestDevices(actor);
  revalidatePath(DEVICES_PAGE_PATH);
}

export async function discoverAugustDevicesAction() {
  const actor = await getCurrentUser();
  await discoverAugustDevices(actor);
  revalidatePath(DEVICES_PAGE_PATH);
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
