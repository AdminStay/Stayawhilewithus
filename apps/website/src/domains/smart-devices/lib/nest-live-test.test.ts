import { describe, expect, it } from "vitest";

import {
  checkNestLiveTestEligibility,
  isNestLiveTestCommand,
  NEST_LIVE_TEST_COMMAND_TYPES,
  NEST_LIVE_TEST_MAX_DEVICES,
  parseNestLiveTestList,
} from "./nest-live-test";

const ID = "11111111-1111-4111-8111-111111111111";

describe("isNestLiveTestCommand", () => {
  it("allows exactly the setpoint commands", () => {
    expect(NEST_LIVE_TEST_COMMAND_TYPES).toEqual([
      "SET_HEAT",
      "SET_COOL",
      "SET_RANGE",
    ]);
    for (const type of NEST_LIVE_TEST_COMMAND_TYPES) {
      expect(isNestLiveTestCommand({ type })).toBe(true);
    }
  });

  it.each(["SET_MODE", "SET_FAN", "", "set_heat", "SET_ECO"])(
    "refuses %j",
    (type) => {
      expect(isNestLiveTestCommand({ type })).toBe(false);
    },
  );

  it("caps the list at 3 thermostats", () => {
    expect(NEST_LIVE_TEST_MAX_DEVICES).toBe(3);
  });
});

describe("parseNestLiveTestList — fails closed", () => {
  it.each([
    null,
    undefined,
    "x",
    [],
    {},
    { nestLiveTest: null },
    { nestLiveTest: [] },
    { nestLiveTest: { smartDeviceIds: "x" } },
    { nestLiveTest: { smartDeviceIds: [ID, "not-a-uuid"] } },
    { nestLiveTest: { smartDeviceIds: [ID, null] } },
  ])("%j → empty", (metadata) => {
    expect(parseNestLiveTestList(metadata).smartDeviceIds).toEqual([]);
  });

  it("reads valid ids and ignores the switch key", () => {
    expect(
      parseNestLiveTestList({
        thermostatControl: { enabled: true },
        nestLiveTest: { smartDeviceIds: [ID], updatedAt: 5 },
      }),
    ).toEqual({ smartDeviceIds: [ID], updatedAt: null, updatedByUserId: null });
  });
});

describe("checkNestLiveTestEligibility", () => {
  const ok = {
    provider: "NEST",
    deviceType: "THERMOSTAT",
    propertyId: "p1",
    externalDeviceId: "ext-1",
    property: { deletedAt: null },
    providerDevice: {
      enabled: true,
      propertyId: "p1",
      externalDeviceId: "ext-1",
    },
  };

  it("an enabled, matching mapping on a live property is eligible", () => {
    expect(checkNestLiveTestEligibility(ok)).toEqual({ eligible: true });
  });

  it("a property with no record is not eligible", () => {
    expect(
      checkNestLiveTestEligibility({ ...ok, property: null }).eligible,
    ).toBe(false);
  });

  it("a mapping without a property is not eligible", () => {
    expect(
      checkNestLiveTestEligibility({
        ...ok,
        providerDevice: { ...ok.providerDevice, propertyId: null },
      }).eligible,
    ).toBe(false);
  });
});
