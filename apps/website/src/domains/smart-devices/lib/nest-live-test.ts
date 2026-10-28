/**
 * Nest limited live test (2026-10-28) — pure rules, no I/O, safe to import
 * from client components.
 *
 * Two server-enforced limits on top of the Nest control switch:
 *   - setpoint-only: mode (including OFF) and fan commands are refused;
 *   - a per-device live-test list: only SmartDevice ids on the list can be
 *     commanded, even with the switch ON. The list is stored on the NEST
 *     IntegrationConnection's metadata under `nestLiveTest` — its own key,
 *     so the switch (`thermostatControl`) and the list never overwrite each
 *     other — and is edited only through setNestLiveTestDevice() (admin,
 *     audited).
 *
 * Widening either limit is a code change, never a toggle.
 */

export const NEST_LIVE_TEST_COMMAND_TYPES = [
  "SET_HEAT",
  "SET_COOL",
  "SET_RANGE",
] as const;

/** UI: hide mode and fan forms while the setpoint-only phase is in force. */
export const NEST_LIVE_TEST_SETPOINT_ONLY = true;

/** At most this many thermostats on the live-test list at once. */
export const NEST_LIVE_TEST_MAX_DEVICES = 3;

export const NEST_SETPOINT_ONLY_REASON =
  "Only setpoint changes are allowed during the Nest live test. Mode and fan commands are disabled. Nothing was sent.";
export const NEST_NOT_ON_LIVE_TEST_LIST_REASON =
  "This thermostat isn't on the Nest live-test list. Nothing was sent.";

export function isNestLiveTestCommand(command: { type: string }): boolean {
  return (NEST_LIVE_TEST_COMMAND_TYPES as readonly string[]).includes(
    command.type,
  );
}

export interface NestLiveTestList {
  smartDeviceIds: string[];
  updatedAt: string | null;
  updatedByUserId: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_LIST: NestLiveTestList = {
  smartDeviceIds: [],
  updatedAt: null,
  updatedByUserId: null,
};

/**
 * Reads the list from the NEST connection's metadata. Fails closed: a
 * missing key, a non-array, or ANY entry that isn't a UUID makes the whole
 * list empty — a malformed list never grants control to anything.
 */
export function parseNestLiveTestList(metadata: unknown): NestLiveTestList {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return EMPTY_LIST;
  }
  const stored = (metadata as Record<string, unknown>).nestLiveTest;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return EMPTY_LIST;
  }
  const { smartDeviceIds, updatedAt, updatedByUserId } = stored as Record<
    string,
    unknown
  >;
  if (
    !Array.isArray(smartDeviceIds) ||
    !smartDeviceIds.every((id) => typeof id === "string" && UUID_RE.test(id))
  ) {
    return EMPTY_LIST;
  }
  return {
    smartDeviceIds: [...new Set(smartDeviceIds as string[])],
    updatedAt: typeof updatedAt === "string" ? updatedAt : null,
    updatedByUserId:
      typeof updatedByUserId === "string" ? updatedByUserId : null,
  };
}

/** The device fields checkNestLiveTestEligibility() needs. */
export interface NestLiveTestCandidate {
  provider: string;
  deviceType: string;
  propertyId: string;
  externalDeviceId: string;
  property: { deletedAt: Date | null } | null;
  providerDevice: {
    enabled: boolean;
    propertyId: string | null;
    externalDeviceId: string;
  } | null;
}

/**
 * Whether a device may be ADDED to the live-test list: a Nest thermostat
 * whose mapping is enabled and points at exactly this device and property,
 * on a property that still exists. sendNestThermostatCommand() re-checks
 * the same mapping rules on every command.
 */
export function checkNestLiveTestEligibility(
  device: NestLiveTestCandidate | null,
): { eligible: true } | { eligible: false; reason: string } {
  if (
    !device ||
    device.provider !== "NEST" ||
    device.deviceType !== "THERMOSTAT"
  ) {
    return { eligible: false, reason: "Nest thermostat not found." };
  }
  const mapping = device.providerDevice;
  if (!mapping || !mapping.enabled || !mapping.propertyId) {
    return {
      eligible: false,
      reason:
        "This thermostat isn't mapped and enabled. Map and enable it from Discovered Devices first.",
    };
  }
  if (
    mapping.propertyId !== device.propertyId ||
    mapping.externalDeviceId !== device.externalDeviceId
  ) {
    return {
      eligible: false,
      reason:
        "This thermostat's mapping doesn't match its property. Fix the mapping in Discovered Devices first.",
    };
  }
  if (!device.property || device.property.deletedAt) {
    return {
      eligible: false,
      reason: "This thermostat's property no longer exists.",
    };
  }
  return { eligible: true };
}
