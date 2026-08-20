import { z } from "zod";

// Sane bounds on a thermostat setpoint request — not an SDM limit (Google's
// SDM docs don't document a min/max Celsius bound, confirmed 2026-08-21),
// just StayWhile's own guard against an obviously-wrong input reaching the
// provider at all. .finite() is explicit here even though min/max already
// exclude +/-Infinity, per the standing rule that server-side validation
// must never assume a value is well-formed just because it's numeric.
const FAHRENHEIT_SETPOINT = z.number().finite().min(40).max(90);

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
