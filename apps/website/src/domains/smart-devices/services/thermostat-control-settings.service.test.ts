import { assertPermission } from "@stayw/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindUnique,
  mockUpdate,
  mockRecordAudit,
  mockExecuteRaw,
  mockDeviceFindUnique,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue({}),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
  mockExecuteRaw: vi.fn().mockResolvedValue(1),
  mockDeviceFindUnique: vi.fn(),
}));

vi.mock("@stayw/database", () => {
  const client = {
    integrationConnection: { findUnique: mockFindUnique, update: mockUpdate },
    smartDevice: { findUnique: mockDeviceFindUnique },
    $executeRaw: mockExecuteRaw,
  };
  return {
    prisma: {
      ...client,
      $transaction: (fn: (tx: typeof client) => unknown) => fn(client),
    },
  };
});

vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import {
  getNestLiveTestList,
  getThermostatControlSetting,
  readNestLiveTestList,
  readThermostatControlSetting,
  setNestLiveTestDevice,
  setThermostatControlEnabled,
} from "./thermostat-control-settings.service";

const actor = { userId: "admin-1" };

describe("Nest thermostat-control kill switch (2026-09-27, Nest Phase 1)", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockClear();
    mockRecordAudit.mockClear();
    mockExecuteRaw.mockClear();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  });

  it("defaults to OFF when the setting has never been stored (existing admins get no live controls on release)", async () => {
    mockFindUnique.mockResolvedValue({ metadata: {} });
    expect(await readThermostatControlSetting()).toEqual({
      enabled: false,
      updatedAt: null,
      updatedByUserId: null,
    });
  });

  it("is OFF when there is no Nest connection at all", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect((await readThermostatControlSetting()).enabled).toBe(false);
  });

  it("only an explicit stored `true` turns it ON; anything else stays OFF", async () => {
    for (const value of [undefined, null, "true", 1, "yes", {}]) {
      mockFindUnique.mockResolvedValue({
        metadata: { thermostatControl: { enabled: value } },
      });
      expect((await readThermostatControlSetting()).enabled).toBe(false);
    }
    mockFindUnique.mockResolvedValue({
      metadata: {
        thermostatControl: {
          enabled: true,
          updatedAt: "2026-09-27T20:00:00.000Z",
          updatedByUserId: "admin-1",
        },
      },
    });
    expect(await readThermostatControlSetting()).toEqual({
      enabled: true,
      updatedAt: "2026-09-27T20:00:00.000Z",
      updatedByUserId: "admin-1",
    });
  });

  it("is independent of the August lock kill switch stored on a different connection", async () => {
    mockFindUnique.mockResolvedValue({
      metadata: { lockControl: { enabled: true } },
    });
    expect((await readThermostatControlSetting()).enabled).toBe(false);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: "NEST" } }),
    );
  });

  it("the dashboard read requires smart_devices:read", async () => {
    mockFindUnique.mockResolvedValue({ metadata: {} });
    await getThermostatControlSetting(actor as never);
    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
  });

  it("toggling requires a GLOBAL thermostats:manage grant (no propertyId) and a denial writes nothing", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      setThermostatControlEnabled(actor as never, true),
    ).rejects.toThrow("Forbidden");
    expect(assertPermission).toHaveBeenCalledWith(actor, "thermostats:manage");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("an admin toggle merges into existing metadata (keeps other keys) and is audit-logged with before/after", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-nest",
      metadata: { other: "keep" },
    });

    const result = await setThermostatControlEnabled(actor as never, true);

    expect(result).toEqual({ status: "success", enabled: true });
    const data = mockUpdate.mock.calls[0]![0].data.metadata;
    expect(data.other).toBe("keep");
    expect(data.thermostatControl).toMatchObject({
      enabled: true,
      updatedByUserId: "admin-1",
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "nest.thermostat_control.set_enabled",
        beforeState: { enabled: false },
        afterState: { enabled: true },
      }),
      expect.anything(),
    );
  });

  it("refuses to toggle when Nest isn't connected", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await setThermostatControlEnabled(actor as never, true)).toEqual({
      status: "rejected",
      reason: expect.stringContaining("Nest isn't connected"),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const PROPERTY_ID = "33333333-3333-4333-8333-333333333333";

function eligibleDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: DEVICE_ID,
    provider: "NEST",
    deviceType: "THERMOSTAT",
    propertyId: PROPERTY_ID,
    externalDeviceId: "nest-ext-1",
    property: { id: PROPERTY_ID, deletedAt: null },
    providerDevice: {
      enabled: true,
      propertyId: PROPERTY_ID,
      externalDeviceId: "nest-ext-1",
    },
    ...overrides,
  };
}

function connectionWith(metadata: Record<string, unknown>) {
  return { id: "conn-nest", metadata };
}

describe("Nest live-test list (2026-10-28)", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockDeviceFindUnique.mockReset().mockResolvedValue(eligibleDevice());
    mockUpdate.mockClear();
    mockRecordAudit.mockClear();
    mockExecuteRaw.mockClear();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  });

  describe("reading fails closed", () => {
    it.each([
      ["no Nest connection", null],
      ["no stored list", { metadata: {} }],
      ["a non-object list", { metadata: { nestLiveTest: "x" } }],
      [
        "ids that aren't an array",
        { metadata: { nestLiveTest: { smartDeviceIds: DEVICE_ID } } },
      ],
      [
        "one malformed entry (the whole list is dropped)",
        {
          metadata: { nestLiveTest: { smartDeviceIds: [DEVICE_ID, "nope"] } },
        },
      ],
      [
        "a non-string entry",
        { metadata: { nestLiveTest: { smartDeviceIds: [DEVICE_ID, 7] } } },
      ],
    ])("%s → empty list", async (_label, row) => {
      mockFindUnique.mockResolvedValue(row);
      expect((await readNestLiveTestList()).smartDeviceIds).toEqual([]);
    });

    it("reads a well-formed list (deduplicated)", async () => {
      mockFindUnique.mockResolvedValue(
        connectionWith({
          nestLiveTest: {
            smartDeviceIds: [DEVICE_ID, DEVICE_ID],
            updatedAt: "2026-10-28T15:00:00.000Z",
            updatedByUserId: "admin-1",
          },
        }),
      );
      expect(await readNestLiveTestList()).toEqual({
        smartDeviceIds: [DEVICE_ID],
        updatedAt: "2026-10-28T15:00:00.000Z",
        updatedByUserId: "admin-1",
      });
    });

    it("is independent of the switch: switch ON with no list is still an empty list", async () => {
      mockFindUnique.mockResolvedValue(
        connectionWith({ thermostatControl: { enabled: true } }),
      );
      expect((await readNestLiveTestList()).smartDeviceIds).toEqual([]);
    });

    it("the dashboard read requires smart_devices:read", async () => {
      mockFindUnique.mockResolvedValue(connectionWith({}));
      await getNestLiveTestList(actor as never);
      expect(assertPermission).toHaveBeenCalledWith(
        actor,
        "smart_devices:read",
      );
    });
  });

  describe("setNestLiveTestDevice", () => {
    it("requires a GLOBAL thermostats:manage grant; a denial locks, reads and writes nothing", async () => {
      vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(
        setNestLiveTestDevice(actor as never, DEVICE_ID, true),
      ).rejects.toThrow("Forbidden");
      expect(assertPermission).toHaveBeenCalledWith(
        actor,
        "thermostats:manage",
      );
      expect(mockExecuteRaw).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("adds an eligible device: row lock first, merged metadata keeps the switch and other keys, audited before/after", async () => {
      mockFindUnique.mockResolvedValue(
        connectionWith({
          other: "keep",
          thermostatControl: {
            enabled: true,
            updatedAt: "2026-10-28T14:00:00.000Z",
            updatedByUserId: "admin-2",
          },
        }),
      );

      const result = await setNestLiveTestDevice(
        actor as never,
        DEVICE_ID,
        true,
      );

      expect(result).toEqual({
        status: "success",
        onList: true,
        smartDeviceIds: [DEVICE_ID],
      });
      // Lock taken before the row is read.
      expect(mockExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockFindUnique.mock.invocationCallOrder[0]!,
      );
      expect(String(mockExecuteRaw.mock.calls[0]![0].join("?"))).toMatch(
        /FROM integration_connections WHERE provider = 'NEST' FOR UPDATE/,
      );
      const data = mockUpdate.mock.calls[0]![0].data.metadata;
      expect(data.other).toBe("keep");
      expect(data.thermostatControl).toEqual({
        enabled: true,
        updatedAt: "2026-10-28T14:00:00.000Z",
        updatedByUserId: "admin-2",
      });
      expect(data.nestLiveTest).toMatchObject({
        smartDeviceIds: [DEVICE_ID],
        updatedByUserId: "admin-1",
      });
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "nest.thermostat_control.live_test_device_set",
          entityType: "IntegrationConnection",
          entityId: "conn-nest",
          beforeState: { smartDeviceIds: [] },
          afterState: {
            smartDeviceIds: [DEVICE_ID],
            smartDeviceId: DEVICE_ID,
            onList: true,
          },
        }),
        expect.anything(),
      );
    });

    it("removes a device (no eligibility check — removal always works), audited before/after", async () => {
      mockFindUnique.mockResolvedValue(
        connectionWith({
          nestLiveTest: { smartDeviceIds: [DEVICE_ID, OTHER_ID] },
        }),
      );
      mockDeviceFindUnique.mockResolvedValue(null); // device gone

      const result = await setNestLiveTestDevice(
        actor as never,
        DEVICE_ID,
        false,
      );

      expect(result).toEqual({
        status: "success",
        onList: false,
        smartDeviceIds: [OTHER_ID],
      });
      expect(mockDeviceFindUnique).not.toHaveBeenCalled();
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeState: { smartDeviceIds: [DEVICE_ID, OTHER_ID] },
          afterState: expect.objectContaining({ smartDeviceIds: [OTHER_ID] }),
        }),
        expect.anything(),
      );
    });

    it("a request that changes nothing writes and audits nothing", async () => {
      mockFindUnique.mockResolvedValue(
        connectionWith({ nestLiveTest: { smartDeviceIds: [DEVICE_ID] } }),
      );
      expect(
        await setNestLiveTestDevice(actor as never, DEVICE_ID, true),
      ).toMatchObject({ status: "success", smartDeviceIds: [DEVICE_ID] });
      mockFindUnique.mockResolvedValue(connectionWith({}));
      expect(
        await setNestLiveTestDevice(actor as never, DEVICE_ID, false),
      ).toMatchObject({ status: "success", smartDeviceIds: [] });
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", null, /not found/],
      ["not Nest", eligibleDevice({ provider: "CIELO" }), /not found/],
      ["not a thermostat", eligibleDevice({ deviceType: "LOCK" }), /not found/],
      [
        "unmapped",
        eligibleDevice({ providerDevice: null }),
        /mapped and enabled/,
      ],
      [
        "disabled",
        eligibleDevice({
          providerDevice: {
            enabled: false,
            propertyId: PROPERTY_ID,
            externalDeviceId: "nest-ext-1",
          },
        }),
        /mapped and enabled/,
      ],
      [
        "mapped to another property",
        eligibleDevice({
          providerDevice: {
            enabled: true,
            propertyId: "44444444-4444-4444-8444-444444444444",
            externalDeviceId: "nest-ext-1",
          },
        }),
        /doesn't match/,
      ],
      [
        "mapped to another Nest device",
        eligibleDevice({
          providerDevice: {
            enabled: true,
            propertyId: PROPERTY_ID,
            externalDeviceId: "nest-ext-OTHER",
          },
        }),
        /doesn't match/,
      ],
      [
        "on a deleted property",
        eligibleDevice({
          property: { id: PROPERTY_ID, deletedAt: new Date() },
        }),
        /no longer exists/,
      ],
    ])(
      "refuses to add a device that is %s, writing nothing",
      async (_l, device, reason) => {
        mockFindUnique.mockResolvedValue(connectionWith({}));
        mockDeviceFindUnique.mockResolvedValue(device);

        const result = await setNestLiveTestDevice(
          actor as never,
          DEVICE_ID,
          true,
        );

        expect(result).toEqual({
          status: "rejected",
          reason: expect.stringMatching(reason),
        });
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockRecordAudit).not.toHaveBeenCalled();
      },
    );

    it("refuses a fourth device (phase-1 cap of 3)", async () => {
      mockFindUnique.mockResolvedValue(
        connectionWith({
          nestLiveTest: {
            smartDeviceIds: [
              "55555555-5555-4555-8555-555555555551",
              "55555555-5555-4555-8555-555555555552",
              "55555555-5555-4555-8555-555555555553",
            ],
          },
        }),
      );

      expect(
        await setNestLiveTestDevice(actor as never, DEVICE_ID, true),
      ).toEqual({
        status: "rejected",
        reason: expect.stringMatching(/already has 3/),
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("refuses when Nest isn't connected", async () => {
      mockFindUnique.mockResolvedValue(null);
      expect(
        await setNestLiveTestDevice(actor as never, DEVICE_ID, true),
      ).toEqual({
        status: "rejected",
        reason: expect.stringContaining("Nest isn't connected"),
      });
    });
  });

  describe("the switch setter preserves the list", () => {
    it("toggling the switch takes the row lock first and keeps nestLiveTest untouched", async () => {
      const list = {
        smartDeviceIds: [DEVICE_ID],
        updatedAt: "2026-10-28T15:00:00.000Z",
        updatedByUserId: "admin-2",
      };
      mockFindUnique.mockResolvedValue(connectionWith({ nestLiveTest: list }));

      await setThermostatControlEnabled(actor as never, true);

      expect(mockExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockFindUnique.mock.invocationCallOrder[0]!,
      );
      expect(mockUpdate.mock.calls[0]![0].data.metadata.nestLiveTest).toEqual(
        list,
      );
    });
  });
});
