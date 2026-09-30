import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindUnique,
  mockUpdate,
  mockFindUniqueOrThrow,
  mockQueryRaw,
  mockAssertPermission,
  mockRecordAudit,
  mockReadControl,
  mockOpenSession,
  mockGetSnapshot,
  mockSendFrame,
  mockCieloClient,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue({}),
  mockFindUniqueOrThrow: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockAssertPermission: vi.fn().mockResolvedValue(undefined),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
  mockReadControl: vi.fn(),
  mockOpenSession: vi.fn(),
  mockGetSnapshot: vi.fn(),
  mockSendFrame: vi.fn(),
  mockCieloClient: vi.fn(),
}));

const tx = {
  $queryRaw: mockQueryRaw,
  smartDevice: { findUniqueOrThrow: mockFindUniqueOrThrow, update: mockUpdate },
};

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: { findUnique: mockFindUnique, update: mockUpdate },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock("@stayw/auth", () => ({ assertPermission: mockAssertPermission }));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));
vi.mock("./cielo-control-settings.service", () => ({
  readCieloControlSetting: mockReadControl,
  CIELO_CONTROL_OFF_REASON: "Remote Cielo thermostat control is OFF.",
}));
vi.mock("@stayw/integrations/cielo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/cielo")>();
  return {
    // Real pure rules; only I/O is faked.
    buildCieloSetpointFrame: actual.buildCieloSetpointFrame,
    validateCieloSetpoint: actual.validateCieloSetpoint,
    parseCieloControlSnapshot: actual.parseCieloControlSnapshot,
    sendCieloFrameAndAwaitState: mockSendFrame,
    CieloClient: mockCieloClient.mockImplementation(() => ({
      openControlSession: mockOpenSession,
      getControlSnapshot: mockGetSnapshot,
    })),
  };
});

const { sendCieloSetpointCommand, isCieloDeviceOnControlAllowlist } =
  await import("./cielo-commands.service");
const { parseCieloControlSnapshot } = await import("@stayw/integrations/cielo");

const ACTOR = { userId: "admin-1" };
const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const MAC = "AA:BB:CC:DD:EE:01";
const PROPERTY = "prop-island-tides";

const device = (o: Record<string, unknown> = {}) => ({
  id: DEVICE_ID,
  provider: "CIELO",
  deviceType: "THERMOSTAT",
  externalDeviceId: MAC,
  propertyId: PROPERTY,
  metadata: { targetTemperature: 72 },
  property: { id: PROPERTY, name: "Island Tides", deletedAt: null },
  ...o,
});

const live = (latestTemp = "72", o: Record<string, unknown> = {}) => ({
  snapshot: parseCieloControlSnapshot({
    deviceName: "Island Tides - Man cave",
    macAddress: MAC,
    deviceStatus: 1,
    isFaren: 1,
    applianceType: "HP",
    applianceId: 1674,
    fwVersion: "2.4.1",
    deviceTypeVersion: "BI03",
    connectionSource: 0,
    latEnv: { temp: 70 },
    latestAction: {
      power: "on",
      mode: "cool",
      fanspeed: "auto",
      temp: latestTemp,
      swing: "auto",
    },
    appliance: { isFaren: 1, temp: "62:86", mode: "heat:cool:auto" },
    ...o,
  }),
  device: {
    id: MAC,
    name: "Island Tides - Man cave",
    online: true,
    targetTemperature: Number(latestTemp),
  },
});

const sent = (o: Record<string, unknown> = {}) => ({
  sendState: "sent",
  confirmedByStateUpdate: false,
  stateUpdateSeen: false,
  reportedTargetF: null,
  ...o,
});

const auditResults = () =>
  mockRecordAudit.mock.calls.map(
    (c) => (c[0] as { afterState: { result: string } }).afterState.result,
  );

const noSleep = { sleep: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CIELO_PROPERTY_MAP = JSON.stringify({ [MAC]: PROPERTY });
  process.env.CIELO_USERNAME = "user@example.com";
  process.env.CIELO_PASSWORD = "secret-password";
  mockFindUnique.mockResolvedValue(device());
  mockQueryRaw.mockResolvedValue([{ locked: true }]);
  mockFindUniqueOrThrow.mockResolvedValue({ commandInProgressAt: null });
  mockReadControl.mockResolvedValue({ enabled: true });
  mockOpenSession.mockResolvedValue({
    accessToken: "ACCESS-TOKEN",
    userId: "cu-1",
    sessionId: "stw-1",
  });
  mockGetSnapshot.mockResolvedValue(live("72"));
  mockSendFrame.mockResolvedValue(
    sent({
      confirmedByStateUpdate: true,
      stateUpdateSeen: true,
      reportedTargetF: 74,
    }),
  );
});

afterEach(() => {
  delete process.env.CIELO_PROPERTY_MAP;
  delete process.env.CIELO_USERNAME;
  delete process.env.CIELO_PASSWORD;
});

describe("allowlist (existing mappings only)", () => {
  it("true only for a CIELO thermostat whose MAC maps to the same property", () => {
    const env = { CIELO_PROPERTY_MAP: JSON.stringify({ [MAC]: PROPERTY }) };
    expect(isCieloDeviceOnControlAllowlist(device(), env)).toBe(true);
    expect(
      isCieloDeviceOnControlAllowlist(device({ propertyId: "other" }), env),
    ).toBe(false);
    expect(
      isCieloDeviceOnControlAllowlist(
        device({ externalDeviceId: "7206-OFFICE" }),
        env,
      ),
    ).toBe(false);
    expect(
      isCieloDeviceOnControlAllowlist(device({ provider: "NEST" }), env),
    ).toBe(false);
    expect(isCieloDeviceOnControlAllowlist(device(), {})).toBe(false);
    expect(
      isCieloDeviceOnControlAllowlist(device(), {
        CIELO_PROPERTY_MAP: "not json",
      }),
    ).toBe(false);
  });

  it.each([
    ["no SmartDevice row (e.g. 7206 - Office)", null],
    ["a Nest device", device({ provider: "NEST" })],
    [
      "a retired device",
      device({ metadata: { retiredAt: "2026-09-01T00:00:00Z" } }),
    ],
    ["a deleted property", device({ property: { deletedAt: new Date() } })],
    ["not in CIELO_PROPERTY_MAP", device({ externalDeviceId: "ZZ:ZZ" })],
  ])(
    "rejects %s before RBAC, the switch, or any Cielo call",
    async (_l, row) => {
      mockFindUnique.mockResolvedValue(row);
      const result = await sendCieloSetpointCommand(ACTOR, {
        smartDeviceId: DEVICE_ID,
        targetTemperatureF: 74,
      });
      expect(result.status).toBe("rejected");
      expect(mockAssertPermission).not.toHaveBeenCalled();
      expect(mockCieloClient).not.toHaveBeenCalled();
      expect(mockSendFrame).not.toHaveBeenCalled();
    },
  );
});

describe("authorization, input and kill switch", () => {
  it("checks thermostats:manage scoped to the device's property", async () => {
    await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(mockAssertPermission).toHaveBeenCalledWith(
      ACTOR,
      "thermostats:manage",
      { propertyId: PROPERTY },
    );
  });

  it("an RBAC failure throws and nothing is sent", async () => {
    mockAssertPermission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      sendCieloSetpointCommand(ACTOR, {
        smartDeviceId: DEVICE_ID,
        targetTemperatureF: 74,
      }),
    ).rejects.toThrow("Forbidden");
    expect(mockSendFrame).not.toHaveBeenCalled();
  });

  it("a non-integer target is REJECTED and audited", async () => {
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: 72.5,
    });
    expect(result.status).toBe("rejected");
    expect(auditResults()).toEqual(["REJECTED"]);
    expect(mockCieloClient).not.toHaveBeenCalled();
  });

  it("kill switch OFF → REJECTED + audited, no lock, no Cielo call", async () => {
    mockReadControl.mockResolvedValue({ enabled: false });
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: 74,
    });
    expect(result).toEqual({
      status: "rejected",
      reason: "Remote Cielo thermostat control is OFF.",
    });
    expect(auditResults()).toEqual(["REJECTED"]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockCieloClient).not.toHaveBeenCalled();
  });
});

describe("duplicate / in-flight protection", () => {
  it("advisory lock held elsewhere → already_running, nothing sent", async () => {
    mockQueryRaw.mockResolvedValue([{ locked: false }]);
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: 74,
    });
    expect(result).toEqual({ status: "already_running" });
    expect(mockCieloClient).not.toHaveBeenCalled();
  });

  it("a fresh in-progress marker → already_running", async () => {
    mockFindUniqueOrThrow.mockResolvedValue({
      commandInProgressAt: new Date(),
    });
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: 74,
    });
    expect(result).toEqual({ status: "already_running" });
    expect(mockSendFrame).not.toHaveBeenCalled();
  });

  it("the marker is always cleared afterwards", async () => {
    mockGetSnapshot.mockRejectedValue(new Error("boom"));
    await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: DEVICE_ID },
      data: { commandInProgressAt: null },
    });
  });
});

describe("fresh live read + validation (nothing sent when refused)", () => {
  it.each([
    ["offline", live("72", { deviceStatus: 0 }), 74],
    [
      "powered off",
      live("72", {
        latestAction: {
          power: "off",
          mode: "cool",
          fanspeed: "auto",
          temp: "72",
          swing: "auto",
        },
      }),
      74,
    ],
    ["not Fahrenheit", live("72", { isFaren: 0 }), 74],
    ["> 5°F change", live("72"), 78],
    ["above 85°F", live("84"), 86],
  ])("%s → REJECTED, audited, no frame", async (_l, snapshot, target) => {
    mockGetSnapshot.mockResolvedValue(snapshot);
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: target as number,
    });
    expect(result.status).toBe("rejected");
    expect(mockSendFrame).not.toHaveBeenCalled();
    expect(auditResults()).toEqual(["REJECTED"]);
  });

  it("appliance lookup failed (2026-10-01) → REJECTED with the appliance reason, audited, no frame", async () => {
    const snapshot = live("72");
    mockGetSnapshot.mockResolvedValue({
      ...snapshot,
      snapshot: { ...snapshot.snapshot, applianceLookup: "failed" },
    });
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: 73,
    });
    expect(result).toMatchObject({ status: "rejected" });
    expect((result as { reason: string }).reason).toMatch(/appliance details/);
    expect(mockSendFrame).not.toHaveBeenCalled();
    expect(auditResults()).toEqual(["REJECTED"]);
  });

  it("device not returned by Cielo → REJECTED, no frame", async () => {
    mockGetSnapshot.mockResolvedValue(null);
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: 74,
    });
    expect(result.status).toBe("rejected");
    expect(mockSendFrame).not.toHaveBeenCalled();
  });

  it("Cielo unreachable before sending → FAILED (nothing sent)", async () => {
    mockOpenSession.mockRejectedValue(new Error("Cielo login failed"));
    const result = await sendCieloSetpointCommand(ACTOR, {
      smartDeviceId: DEVICE_ID,
      targetTemperatureF: 74,
    });
    expect(result.status).toBe("failed");
    expect(mockSendFrame).not.toHaveBeenCalled();
    expect(auditResults()).toEqual(["FAILED"]);
  });
});

describe("send + confirmation → SUCCEEDED / FAILED / AMBIGUOUS", () => {
  it("StateUpdate confirms → SUCCEEDED, read back and stored", async () => {
    mockGetSnapshot
      .mockResolvedValueOnce(live("72"))
      .mockResolvedValueOnce(live("74"));
    const result = await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(result).toEqual({ status: "succeeded", confirmedTargetF: 74 });
    expect(mockSendFrame).toHaveBeenCalledTimes(1);
    const frame = mockSendFrame.mock.calls[0]![0].frame as Record<
      string,
      unknown
    >;
    expect(frame).toMatchObject({
      actionType: "temp",
      actionValue: 74,
      macAddress: MAC,
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEVICE_ID },
        data: expect.objectContaining({
          status: "ONLINE",
          metadata: expect.objectContaining({ targetTemperature: 74 }),
        }),
      }),
    );
    const audit = mockRecordAudit.mock.calls.at(-1)![0] as {
      afterState: Record<string, unknown>;
    };
    expect(audit.afterState).toMatchObject({
      command: { type: "SET_TEMPERATURE", targetF: 74 },
      result: "SUCCEEDED",
      commandSent: true,
      confirmedBy: "state_update",
      previousTargetF: 72,
      readBackTargetF: 74,
    });
  });

  it("no StateUpdate but the read-back shows the new value → SUCCEEDED (read_back)", async () => {
    mockSendFrame.mockResolvedValue(sent());
    mockGetSnapshot
      .mockResolvedValueOnce(live("72"))
      .mockResolvedValueOnce(live("74"));
    const result = await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(result.status).toBe("succeeded");
    expect(noSleep.sleep).toHaveBeenCalled();
    expect(
      (
        mockRecordAudit.mock.calls.at(-1)![0] as {
          afterState: { confirmedBy: string };
        }
      ).afterState.confirmedBy,
    ).toBe("read_back");
  });

  it("sent, read-back still shows the old value → AMBIGUOUS (HTTP/socket success is not trusted)", async () => {
    mockSendFrame.mockResolvedValue(sent());
    mockGetSnapshot
      .mockResolvedValueOnce(live("72"))
      .mockResolvedValueOnce(live("72"));
    const result = await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(result).toMatchObject({ status: "ambiguous", readBackTargetF: 72 });
    expect(auditResults()).toEqual(["AMBIGUOUS"]);
  });

  it("socket failed after sending and the read-back failed → AMBIGUOUS", async () => {
    mockSendFrame.mockResolvedValue(
      sent({ sendState: "uncertain", error: "socket hang up" }),
    );
    mockGetSnapshot
      .mockResolvedValueOnce(live("72"))
      .mockRejectedValueOnce(new Error("timeout"));
    const result = await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(result).toMatchObject({
      status: "ambiguous",
      readBackTargetF: null,
    });
  });

  it("connection never opened → FAILED, nothing sent, no read-back", async () => {
    mockSendFrame.mockResolvedValue(
      sent({ sendState: "not_sent", error: "403" }),
    );
    const result = await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(result.status).toBe("failed");
    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
    expect(
      (
        mockRecordAudit.mock.calls.at(-1)![0] as {
          afterState: Record<string, unknown>;
        }
      ).afterState,
    ).toMatchObject({
      result: "FAILED",
      commandSent: false,
    });
  });

  it("an unexpected error after the frame may have gone out → AMBIGUOUS, never 'nothing sent'", async () => {
    mockSendFrame.mockRejectedValue(new Error("crash"));
    const result = await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    expect(result.status).toBe("ambiguous");
    expect(auditResults()).toEqual(["AMBIGUOUS"]);
  });

  it("never puts credentials or tokens into the audit log", async () => {
    await sendCieloSetpointCommand(
      ACTOR,
      { smartDeviceId: DEVICE_ID, targetTemperatureF: 74 },
      noSleep,
    );
    const text = JSON.stringify(mockRecordAudit.mock.calls);
    expect(text).not.toContain("ACCESS-TOKEN");
    expect(text).not.toContain("secret-password");
    expect(text).not.toContain("user@example.com");
  });
});
