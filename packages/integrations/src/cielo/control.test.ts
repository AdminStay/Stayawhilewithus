import { describe, expect, it, vi } from "vitest";

import {
  buildCieloSetpointFrame,
  cieloSetpointRange,
  parseCieloControlSnapshot,
  sendCieloFrameAndAwaitState,
  validateCieloSetpoint,
  type CieloSocketFactory,
} from "./control";

// Shape of a real `/web/devices` entry (fields per bodyscape/cielo_home).
function rawDevice(overrides: Record<string, unknown> = {}) {
  return {
    deviceName: "Island Tides - Man cave",
    macAddress: "AA:BB:CC:DD:EE:01",
    deviceStatus: 1,
    isFaren: 1,
    applianceType: "HP",
    applianceId: 1674,
    fwVersion: "2.4.1",
    deviceTypeVersion: "BI03",
    connectionSource: 0,
    myRuleConfiguration: { rule: "x" },
    latEnv: { temp: 70, humidity: 45 },
    latestAction: {
      power: "on",
      mode: "cool",
      fanspeed: "auto",
      temp: "72",
      swing: "auto",
      timestamp: 1790000000,
    },
    appliance: { isFaren: 1, temp: "62:86", mode: "heat:cool:auto" },
    ...overrides,
  };
}

const snap = (o: Record<string, unknown> = {}) =>
  parseCieloControlSnapshot(rawDevice(o));

describe("parseCieloControlSnapshot", () => {
  it("reads the control fields and Fahrenheit readings", () => {
    const s = snap();
    expect(s).toMatchObject({
      macAddress: "AA:BB:CC:DD:EE:01",
      online: true,
      deviceIsFahrenheit: true,
      applianceIsFahrenheit: true,
      applianceTempRange: "62:86",
      applianceId: 1674,
      applianceType: "HP",
      fwVersion: "2.4.1",
      deviceTypeVersion: "BI03",
      connectionSource: 0,
      currentTemperatureF: 70,
      targetTemperatureF: 72,
    });
  });

  it("never reports temperatures when the device isn't Fahrenheit", () => {
    const s = snap({ isFaren: 0 });
    expect(s.currentTemperatureF).toBeNull();
    expect(s.targetTemperatureF).toBeNull();
  });

  it("uses the per-mode range for multi-range appliances", () => {
    const s = snap({
      appliance: {
        isFaren: 1,
        temp: "62:86",
        isMultiModeTempRange: 1,
        modesTemp: [{ mode: "cool", temp: "64:80" }],
      },
    });
    expect(cieloSetpointRange(s)).toEqual({ min: 64, max: 80 });
  });
});

describe("validateCieloSetpoint — every rule", () => {
  it("allows a small in-range change on a powered, online, Fahrenheit unit", () => {
    expect(validateCieloSetpoint(snap(), 74)).toEqual({
      allowed: true,
      currentTargetF: 72,
      bounds: { min: 62, max: 85 },
    });
  });

  it.each([
    ["non-integer", {}, 72.5, /whole number/],
    ["offline", { deviceStatus: 0 }, 73, /offline/],
    ["device not Fahrenheit", { isFaren: 0 }, 73, /Fahrenheit/],
    [
      "appliance not Fahrenheit",
      { appliance: { isFaren: 0, temp: "17:30", mode: "heat:cool" } },
      73,
      /Fahrenheit/,
    ],
    [
      "powered off",
      {
        latestAction: {
          power: "off",
          mode: "cool",
          fanspeed: "auto",
          temp: "72",
          swing: "auto",
        },
      },
      73,
      /powered off/,
    ],
    [
      "fan mode",
      {
        latestAction: {
          power: "on",
          mode: "fan",
          fanspeed: "auto",
          temp: "72",
          swing: "auto",
        },
      },
      73,
      /heat, cool or auto/,
    ],
    [
      "inc:dec only unit",
      { appliance: { isFaren: 1, temp: "inc:dec", mode: "cool" } },
      73,
      /absolute temperature range/,
    ],
    ["below 60°F", {}, 59, /between/],
    ["above 85°F", {}, 86, /between/],
    ["no-op", {}, 72, /already 72/],
    ["more than 5°F", {}, 78, /at most 5/],
    ["missing applianceId", { applianceId: undefined }, 73, /device details/],
  ])("refuses: %s", (_label, overrides, target, reason) => {
    const result = validateCieloSetpoint(snap(overrides), target as number);
    expect(result.allowed).toBe(false);
    expect((result as { reason: string }).reason).toMatch(reason);
  });

  it("the appliance's own narrower range wins over 60–85", () => {
    const s = snap({ appliance: { isFaren: 1, temp: "68:76", mode: "cool" } });
    expect(validateCieloSetpoint(s, 67)).toMatchObject({ allowed: false });
    expect(validateCieloSetpoint(s, 76)).toMatchObject({ allowed: true });
  });
});

describe("buildCieloSetpointFrame — mirrors the reference exactly", () => {
  it("one actionControl frame; only temp changes; nothing else", () => {
    const frame = buildCieloSetpointFrame(
      snap(),
      { userId: "user-9" },
      74,
      1790000123,
    );
    expect(frame).toEqual({
      action: "actionControl",
      actionSource: "WEB",
      macAddress: "AA:BB:CC:DD:EE:01",
      user_id: "user-9",
      fw_version: "2.4.1",
      deviceTypeVersion: "BI03",
      mid: "WEB",
      connection_source: 0,
      application_version: "1.4.4",
      ts: 1790000123,
      fwVersion: "2.4.1",
      applianceType: "HP",
      applianceId: 1674,
      myRuleConfiguration: { rule: "x" },
      preset: 0,
      actions: {
        power: "on",
        mode: "cool",
        fanspeed: "auto",
        temp: "74",
        swing: "auto",
        swinginternal: "",
        light: "off",
      },
      oldPower: "on",
      actionType: "temp",
      actionValue: 74,
    });
  });

  it("carries an existing light value (on/off → off) and never invents turbo/followme", () => {
    const frame = buildCieloSetpointFrame(
      snap({
        latestAction: {
          power: "on",
          mode: "heat",
          fanspeed: "low",
          temp: "70",
          swing: "pos1",
          light: "on/off",
        },
      }),
      { userId: "u" },
      71,
      1,
    );
    expect(frame.actions).toEqual({
      power: "on",
      mode: "heat",
      fanspeed: "low",
      temp: "71",
      swing: "pos1",
      swinginternal: "",
      light: "off",
    });
  });
});

type Handler = (...args: unknown[]) => void;
function fakeSocket() {
  const handlers: Record<string, Handler> = {};
  const sent: string[] = [];
  const socket = {
    on: (event: string, h: Handler) => {
      handlers[event] = h;
      return socket;
    },
    send: vi.fn((data: string, cb?: (err?: Error) => void) => {
      sent.push(data);
      cb?.();
    }),
    close: vi.fn(),
  };
  return { socket, handlers, sent };
}

const SESSION = { accessToken: "tok en", sessionId: "stw-1" };

describe("sendCieloFrameAndAwaitState", () => {
  it("connects with the reference URL/headers, sends ONE frame, and confirms on this device's StateUpdate", async () => {
    const fake = fakeSocket();
    const factory = vi.fn(() => fake.socket) as unknown as CieloSocketFactory;
    const promise = sendCieloFrameAndAwaitState({
      session: SESSION,
      frame: { a: 1 },
      macAddress: "AA:BB:CC:DD:EE:01",
      targetF: 74,
      timeoutMs: 1000,
      createSocket: factory,
    });
    expect(factory).toHaveBeenCalledWith(
      "wss://wss.smartcielo.com/websocket/?sessionId=stw-1&token=tok%20en",
      expect.objectContaining({
        origin: "https://home.cielowigle.com",
        headers: expect.objectContaining({ Host: "wss.smartcielo.com" }),
      }),
    );
    fake.handlers.open!();
    // Another device's update is ignored.
    fake.handlers.message!(
      JSON.stringify({
        message_type: "StateUpdate",
        mac_address: "OTHER",
        action: { temp: "74" },
      }),
    );
    fake.handlers.message!(
      JSON.stringify({
        message_type: "StateUpdate",
        mac_address: "AA:BB:CC:DD:EE:01",
        action: { temp: "74" },
      }),
    );
    const outcome = await promise;
    expect(fake.sent).toEqual([JSON.stringify({ a: 1 })]);
    expect(outcome).toMatchObject({
      sendState: "sent",
      confirmedByStateUpdate: true,
      stateUpdateSeen: true,
      reportedTargetF: 74,
    });
    expect(fake.socket.close).toHaveBeenCalled();
  });

  it("sent but only an old value arrives before the timeout → not confirmed", async () => {
    vi.useFakeTimers();
    const fake = fakeSocket();
    const promise = sendCieloFrameAndAwaitState({
      session: SESSION,
      frame: {},
      macAddress: "M",
      targetF: 74,
      timeoutMs: 500,
      createSocket: () => fake.socket as never,
    });
    fake.handlers.open!();
    fake.handlers.message!(
      JSON.stringify({
        message_type: "StateUpdate",
        mac_address: "M",
        action: { temp: "72" },
      }),
    );
    vi.advanceTimersByTime(600);
    const outcome = await promise;
    vi.useRealTimers();
    expect(outcome).toMatchObject({
      sendState: "sent",
      confirmedByStateUpdate: false,
      stateUpdateSeen: true,
      reportedTargetF: 72,
    });
  });

  it("an error before the socket opens → not_sent (nothing reached Cielo)", async () => {
    const fake = fakeSocket();
    const promise = sendCieloFrameAndAwaitState({
      session: SESSION,
      frame: {},
      macAddress: "M",
      targetF: 74,
      timeoutMs: 1000,
      createSocket: () => fake.socket as never,
    });
    fake.handlers.error!(new Error("Unexpected server response: 403"));
    const outcome = await promise;
    expect(outcome.sendState).toBe("not_sent");
    expect(fake.sent).toHaveLength(0);
  });

  it("an error after sending → uncertain", async () => {
    const fake = fakeSocket();
    const promise = sendCieloFrameAndAwaitState({
      session: SESSION,
      frame: {},
      macAddress: "M",
      targetF: 74,
      timeoutMs: 1000,
      createSocket: () => fake.socket as never,
    });
    fake.handlers.open!();
    fake.handlers.error!(new Error("socket hang up"));
    const outcome = await promise;
    expect(outcome.sendState).toBe("uncertain");
    expect(outcome.confirmedByStateUpdate).toBe(false);
  });

  it("the socket factory throwing → not_sent", async () => {
    const outcome = await sendCieloFrameAndAwaitState({
      session: SESSION,
      frame: {},
      macAddress: "M",
      targetF: 74,
      timeoutMs: 1000,
      createSocket: () => {
        throw new Error("bad url");
      },
    });
    expect(outcome.sendState).toBe("not_sent");
  });
});
