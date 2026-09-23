import { z } from "zod";

export const retireSmartDeviceSchema = z.object({
  smartDeviceId: z.string().uuid(),
});

export type RetireSmartDeviceInput = z.infer<typeof retireSmartDeviceSchema>;
