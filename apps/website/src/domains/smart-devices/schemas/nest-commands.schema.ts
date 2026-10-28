import { z } from "zod";

import { NEST_SETPOINT_SAFETY } from "../lib/nest-command-safety";

// StayWhile's own setpoint bounds — not an SDM limit (Google's SDM docs
// don't document a min/max Celsius bound, confirmed 2026-08-21). Whole °F
// inside 60–85 °F (2026-10-28, the same band as Cielo); the 5 °F step and
// the live-state rules are re-checked server-side against a fresh Nest read
// (checkNestCommandSafety) before anything is sent. .finite() is explicit
// even though min/max already exclude +/-Infinity, per the standing rule
// that server-side validation must never assume a value is well-formed.
const FAHRENHEIT_SETPOINT = z
  .number()
  .finite()
  .int()
  .min(NEST_SETPOINT_SAFETY.minF)
  .max(NEST_SETPOINT_SAFETY.maxF);

export const setNestHeatSetpointSchema = z.object({
  smartDeviceId: z.string().uuid(),
  heatFahrenheit: FAHRENHEIT_SETPOINT,
});
export type SetNestHeatSetpointInput = z.infer<
  typeof setNestHeatSetpointSchema
>;

export const setNestCoolSetpointSchema = z.object({
  smartDeviceId: z.string().uuid(),
  coolFahrenheit: FAHRENHEIT_SETPOINT,
});
export type SetNestCoolSetpointInput = z.infer<
  typeof setNestCoolSetpointSchema
>;

export const setNestHeatCoolRangeSchema = z
  .object({
    smartDeviceId: z.string().uuid(),
    heatFahrenheit: FAHRENHEIT_SETPOINT,
    coolFahrenheit: FAHRENHEIT_SETPOINT,
  })
  .refine((v) => v.heatFahrenheit < v.coolFahrenheit, {
    message: "Heat target must be lower than cool target.",
  });
export type SetNestHeatCoolRangeInput = z.infer<
  typeof setNestHeatCoolRangeSchema
>;

export const setNestModeSchema = z.object({
  smartDeviceId: z.string().uuid(),
  mode: z.enum(["HEAT", "COOL", "HEATCOOL", "OFF"]),
});
export type SetNestModeInput = z.infer<typeof setNestModeSchema>;

export const setNestFanSchema = z.object({
  smartDeviceId: z.string().uuid(),
  timerMode: z.enum(["ON", "OFF"]),
  // SDM's own documented max is 12h (43200s) — enforced again server-side
  // in NestClient.setFanTimer(), this is just the form-level bound.
  durationMinutes: z.number().int().min(1).max(720).optional(),
});
export type SetNestFanInput = z.infer<typeof setNestFanSchema>;

/** Admin kill switch for all remote Nest thermostat commands (2026-09-27). */
export const setThermostatControlEnabledSchema = z.object({
  enabled: z.enum(["true", "false"]).transform((v) => v === "true"),
});
