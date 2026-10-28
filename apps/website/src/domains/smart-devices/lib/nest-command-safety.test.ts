import type { NestDevice } from "@stayw/integrations/nest";
import { describe, expect, it } from "vitest";

import {
  checkNestCommandSafety,
  isNestCommandConfirmed,
} from "./nest-command-safety";
import { fahrenheitToCelsius as c } from "./temperature";

function device(overrides: Partial<NestDevice> = {}): NestDevice {
  return {
    externalDeviceId: "nest-1",
    resourceName: "enterprises/p/devices/nest-1",
    deviceType: "sdm.devices.types.THERMOSTAT",
    connectivity: "ONLINE",
    thermostatMode: "COOL",
    heatCelsius: c(68),
    coolCelsius: c(72),
    fanTimerMode: "OFF",
    rawTraits: {},
    ...overrides,
  };
}

describe("checkNestCommandSafety — availability", () => {
  it("refuses an OFFLINE thermostat for every command", () => {
    for (const command of [
      { type: "SET_COOL", coolCelsius: c(73) },
      { type: "SET_MODE", mode: "HEAT" },
      { type: "SET_FAN", timerMode: "ON" },
    ] as const) {
      expect(
        checkNestCommandSafety(command, device({ connectivity: "OFFLINE" })),
      ).toEqual({
        allowed: false,
        reason: expect.stringMatching(/offline/),
      });
    }
  });

  it("refuses when Nest doesn't report connectivity at all", () => {
    expect(
      checkNestCommandSafety(
        { type: "SET_COOL", coolCelsius: c(73) },
        device({ connectivity: undefined }),
      ),
    ).toEqual({
      allowed: false,
      reason: expect.stringMatching(/didn't report whether/),
    });
  });
});

describe("checkNestCommandSafety — setpoint limits", () => {
  it("allows a whole-degree change inside 60–85 °F and within 5 °F", () => {
    expect(
      checkNestCommandSafety(
        { type: "SET_COOL", coolCelsius: c(77) },
        device(),
      ),
    ).toEqual({ allowed: true });
    expect(
      checkNestCommandSafety(
        { type: "SET_HEAT", heatCelsius: c(63) },
        device(),
      ),
    ).toEqual({ allowed: true });
  });

  it.each([59, 86, 40, 90])("refuses %i °F (outside 60–85 °F)", (f) => {
    const result = checkNestCommandSafety(
      { type: "SET_COOL", coolCelsius: c(f) },
      device({ coolCelsius: c(f > 85 ? 85 : 60) }),
    );
    expect(result).toEqual({
      allowed: false,
      reason: "Choose a temperature between 60°F and 85°F.",
    });
  });

  it("accepts the exact 60 °F and 85 °F bounds despite float conversion", () => {
    expect(
      checkNestCommandSafety(
        { type: "SET_HEAT", heatCelsius: c(60) },
        device({ heatCelsius: c(62) }),
      ).allowed,
    ).toBe(true);
    expect(
      checkNestCommandSafety(
        { type: "SET_COOL", coolCelsius: c(85) },
        device({ coolCelsius: c(82) }),
      ).allowed,
    ).toBe(true);
  });

  it("refuses a change of more than 5 °F from the current setpoint", () => {
    expect(
      checkNestCommandSafety(
        { type: "SET_COOL", coolCelsius: c(78) },
        device(),
      ),
    ).toEqual({
      allowed: false,
      reason:
        "Change the cool setpoint by at most 5°F at a time (currently 72°F).",
    });
  });

  it("refuses when the current setpoint isn't known", () => {
    expect(
      checkNestCommandSafety(
        { type: "SET_HEAT", heatCelsius: c(70) },
        device({ heatCelsius: undefined }),
      ),
    ).toEqual({
      allowed: false,
      reason: expect.stringMatching(/current heat setpoint/),
    });
  });

  it("refuses a no-op setpoint change", () => {
    expect(
      checkNestCommandSafety(
        { type: "SET_COOL", coolCelsius: c(72) },
        device(),
      ),
    ).toEqual({ allowed: false, reason: "The cool setpoint is already 72°F." });
  });

  it("checks both bounds of a heat/cool range", () => {
    expect(
      checkNestCommandSafety(
        { type: "SET_RANGE", heatCelsius: c(66), coolCelsius: c(74) },
        device(),
      ),
    ).toEqual({ allowed: true });
    expect(
      checkNestCommandSafety(
        { type: "SET_RANGE", heatCelsius: c(61), coolCelsius: c(74) },
        device(),
      ).allowed,
    ).toBe(false);
    expect(
      checkNestCommandSafety(
        { type: "SET_RANGE", heatCelsius: c(68), coolCelsius: c(72) },
        device(),
      ),
    ).toEqual({
      allowed: false,
      reason: "The thermostat already has this heat/cool range.",
    });
  });

  it("refuses switching to the mode the thermostat is already in", () => {
    expect(
      checkNestCommandSafety({ type: "SET_MODE", mode: "COOL" }, device()),
    ).toEqual({
      allowed: false,
      reason: "The thermostat is already in COOL mode.",
    });
  });
});

describe("isNestCommandConfirmed", () => {
  it("setpoint: confirmed within half a degree °F of the request (Nest's own rounding)", () => {
    const command = { type: "SET_COOL", coolCelsius: c(73) } as const;
    expect(
      isNestCommandConfirmed(command, device({ coolCelsius: 22.78 })),
    ).toBe(true);
    expect(
      isNestCommandConfirmed(command, device({ coolCelsius: c(72) })),
    ).toBe(false);
    expect(
      isNestCommandConfirmed(command, device({ coolCelsius: undefined })),
    ).toBe(false);
  });

  it("range: both bounds must match", () => {
    const command = {
      type: "SET_RANGE",
      heatCelsius: c(66),
      coolCelsius: c(74),
    } as const;
    expect(
      isNestCommandConfirmed(
        command,
        device({ heatCelsius: c(66), coolCelsius: c(74) }),
      ),
    ).toBe(true);
    expect(
      isNestCommandConfirmed(
        command,
        device({ heatCelsius: c(66), coolCelsius: c(72) }),
      ),
    ).toBe(false);
  });

  it("mode and fan compare the reported state", () => {
    expect(
      isNestCommandConfirmed(
        { type: "SET_MODE", mode: "HEAT" },
        device({ thermostatMode: "HEAT" }),
      ),
    ).toBe(true);
    expect(
      isNestCommandConfirmed({ type: "SET_MODE", mode: "HEAT" }, device()),
    ).toBe(false);
    expect(
      isNestCommandConfirmed(
        { type: "SET_FAN", timerMode: "ON" },
        device({ fanTimerMode: "ON" }),
      ),
    ).toBe(true);
    expect(
      isNestCommandConfirmed({ type: "SET_FAN", timerMode: "ON" }, device()),
    ).toBe(false);
  });
});
