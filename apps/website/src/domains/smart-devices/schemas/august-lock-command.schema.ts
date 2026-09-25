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
