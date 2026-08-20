import { z } from "zod";

export const mapProviderDeviceToPropertySchema = z.object({
  providerDeviceId: z.string().uuid(),
  propertyId: z.string().uuid(),
});

export type MapProviderDeviceToPropertyInput = z.infer<
  typeof mapProviderDeviceToPropertySchema
>;

export const unmapProviderDeviceSchema = z.object({
  providerDeviceId: z.string().uuid(),
});

export type UnmapProviderDeviceInput = z.infer<
  typeof unmapProviderDeviceSchema
>;

/**
 * Enabling requires the device to already be mapped to a property (see
 * setProviderDeviceEnabled() in provider-devices.service.ts) — this schema
 * only validates shape, not that precondition.
 */
export const setProviderDeviceEnabledSchema = z.object({
  providerDeviceId: z.string().uuid(),
  enabled: z.boolean(),
});

export type SetProviderDeviceEnabledInput = z.infer<
  typeof setProviderDeviceEnabledSchema
>;
