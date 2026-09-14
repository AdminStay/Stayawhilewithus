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

/**
 * Same shape and the same service (refreshAugustTelemetryForSelectedLocks())
 * as refreshAugustSpotSchema above — this is not a second refresh
 * implementation, only a stricter upper bound for a UI that submits several
 * ids from one operator action instead of one row at a time. The cap of 5
 * matches AUGUST_DETAIL_CONCURRENCY (provider-devices.service.ts): a batch
 * at or under that size runs as exactly one internal concurrency-bounded
 * pass inside the service, so this schema is what keeps every real
 * invocation within the size the service was already proven safe for,
 * rather than trusting the caller to self-limit.
 */
export const refreshAugustBatchSchema = z.object({
  smartDeviceIds: z.array(z.string().uuid()).min(1).max(5),
});

export type RefreshAugustBatchInput = z.infer<typeof refreshAugustBatchSchema>;
