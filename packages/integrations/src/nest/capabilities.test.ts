import { describe, expect, it } from "vitest";

// Imported directly from ./capabilities, not ./client — this is the exact
// module NestThermostatControls.tsx (a "use client" component) imports,
// specifically because it must never pull in NestClient/../core (which
// depend on node:crypto and break the browser build — see client.ts's
// module doc comment). These tests exist to prove this module has zero
// dependency on anything network/Node-specific, standalone from client.ts.
import {
  computeNestDeviceCapabilities,
  getSupportedNestControls,
  parseNestDevice,
  sanitizeTraits,
  validateNestCommand,
} from "./capabilities";

describe("capabilities module is self-contained (no NestClient/HttpClient/core import)", () => {
  it("parses a device end-to-end using only this module", () => {
    const device = parseNestDevice({
      name: "enterprises/proj/devices/d1",
      type: "sdm.devices.types.THERMOSTAT",
      traits: {
        "sdm.devices.traits.Temperature": { ambientTemperatureCelsius: 21 },
      },
    });
    expect(device.ambientTemperatureCelsius).toBe(21);
  });

  it("sanitizes, computes capabilities, and validates a command using only this module", () => {
    const traits = sanitizeTraits({
      "sdm.devices.traits.ThermostatMode": {
        mode: "COOL",
        availableModes: ["COOL", "OFF"],
      },
    });
    const capabilities = computeNestDeviceCapabilities(traits);
    const availability = getSupportedNestControls(capabilities);
    const validation = validateNestCommand(
      { type: "SET_COOL", coolCelsius: 24 },
      capabilities,
    );

    expect(availability.canSetCool).toBe(true);
    expect(availability.canSetHeat).toBe(false);
    expect(validation).toEqual({ allowed: true });
  });
});
