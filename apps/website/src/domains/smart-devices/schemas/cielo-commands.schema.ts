import { CIELO_SETPOINT_SAFETY } from "@stayw/integrations/cielo";
import { z } from "zod";

/**
 * Cielo setpoint form input (2026-09-30). Whole °F inside the global
 * 60–85 °F safety band; the per-device range, the max 5 °F step and every
 * live-state rule are re-checked server-side against a fresh Cielo read
 * (validateCieloSetpoint) before anything is sent.
 */
export const setCieloSetpointSchema = z.object({
  smartDeviceId: z.string().uuid(),
  targetTemperatureF: z
    .number()
    .int()
    .min(CIELO_SETPOINT_SAFETY.minF)
    .max(CIELO_SETPOINT_SAFETY.maxF),
});

export const setCieloControlEnabledSchema = z.object({
  enabled: z.enum(["true", "false"]).transform((v) => v === "true"),
});
