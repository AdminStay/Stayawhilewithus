import { z } from "zod";

export const sendAugustLockCommandSchema = z.object({
  smartDeviceId: z.string().uuid(),
  operation: z.enum(["LOCK", "UNLOCK", "UNLATCH"]),
});
export type SendAugustLockCommandInput = z.infer<
  typeof sendAugustLockCommandSchema
>;

/** Admin kill switch toggle — the submitted target value, never inferred. */
export const setLockControlEnabledSchema = z.object({
  enabled: z.enum(["true", "false"]).transform((v) => v === "true"),
});

/**
 * Admin "reset after physical check". `confirmedInPerson` must be the
 * checked checkbox value — the reset is refused without it.
 */
export const resetAugustLockSchema = z.object({
  smartDeviceId: z.string().uuid(),
  observedLockState: z.enum(["locked", "unlocked"]),
  confirmedInPerson: z.literal("on"),
  note: z.string().trim().max(500).optional(),
});

/** Admin operational hold (2026-09-26). A note is required so the reason is always recorded. */
export const setLockOperationalHoldSchema = z.object({
  smartDeviceId: z.string().uuid(),
  kind: z.enum([
    "OUT_OF_SERVICE",
    "ONSITE_INSPECTION_REQUIRED",
    "EXCLUDED_FROM_TESTING",
  ]),
  note: z.string().trim().min(3).max(500),
});

export const clearLockOperationalHoldSchema = z.object({
  smartDeviceId: z.string().uuid(),
  note: z.string().trim().min(3).max(500),
});
