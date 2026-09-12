import { z } from "zod";

/**
 * The service layer accepts an explicit array of existing SmartDevice.id
 * values — never a name, provider label, property, or search term — so a
 * future multi-select UI needs no service-layer change. The current UI
 * (one row = one id) always submits a single-element array; this schema
 * itself doesn't assume either shape, only that every entry is a real
 * UUID and at least one was provided.
 */
export const refreshAugustSpotSchema = z.object({
  smartDeviceIds: z.array(z.string().uuid()).min(1),
});

export type RefreshAugustSpotInput = z.infer<typeof refreshAugustSpotSchema>;
