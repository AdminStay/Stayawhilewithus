import { z } from "zod";

export const sendAugustLockCommandSchema = z.object({
  smartDeviceId: z.string().uuid(),
  operation: z.enum(["LOCK", "UNLOCK", "UNLATCH"]),
});
export type SendAugustLockCommandInput = z.infer<
  typeof sendAugustLockCommandSchema
>;
