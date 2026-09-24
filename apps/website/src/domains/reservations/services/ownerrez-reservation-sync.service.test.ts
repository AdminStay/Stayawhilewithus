import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListBookings,
  mockGetGuest,
  mockQueryRaw,
  mockEnsureConnectionRows,
  mockRecordAudit,
  mockConnectionFindUniqueOrThrow,
  mockConnectionUpdate,
  mockSyncLogFindFirst,
  mockSyncLogCreate,
  mockSyncLogUpdate,
  mockPropertyFindMany,
  mockGuestFindMany,
  mockGuestUpsert,
  mockReservationFindUnique,
  mockReservationFindMany,
  mockReservationCreate,
  mockReservationUpdate,
  mockReservationGuestUpsert,
} = vi.hoisted(() => ({
  mockListBookings: vi.fn(),
  mockGetGuest: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockEnsureConnectionRows: vi.fn().mockResolvedValue(undefined),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
  mockConnectionFindUniqueOrThrow: vi.fn(),
  mockConnectionUpdate: vi.fn().mockResolvedValue({}),
  mockSyncLogFindFirst: vi.fn().mockResolvedValue(null),
  mockSyncLogCreate: vi.fn(),
  mockSyncLogUpdate: vi.fn().mockResolvedValue({}),
  mockPropertyFindMany: vi.fn(),
  mockGuestFindMany: vi.fn(),
  mockGuestUpsert: vi.fn(),
  mockReservationFindUnique: vi.fn(),
  mockReservationFindMany: vi.fn(),
  mockReservationCreate: vi.fn(),
  mockReservationUpdate: vi.fn(),
  mockReservationGuestUpsert: vi.fn().mockResolvedValue({}),
}));

const txClient = {
  $queryRaw: mockQueryRaw,
  integrationSyncLog: {
    findFirst: mockSyncLogFindFirst,
    create: mockSyncLogCreate,
  },
  reservation: { create: mockReservationCreate, update: mockReservationUpdate },
  reservationGuest: { upsert: mockReservationGuestUpsert },
};

vi.mock("@stayw/database", () => ({
  prisma: {
    property: { findMany: mockPropertyFindMany },
    guest: { findMany: mockGuestFindMany, upsert: mockGuestUpsert },
    reservation: {
      findUnique: mockReservationFindUnique,
      findMany: mockReservationFindMany,
    },
    integrationConnection: {
      findUniqueOrThrow: mockConnectionFindUniqueOrThrow,
      update: mockConnectionUpdate,
    },
    integrationSyncLog: { update: mockSyncLogUpdate },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: typeof txClient) => unknown)(txClient);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@stayw/integrations/ownerrez", () => ({
  OwnerrezClient: vi.fn().mockImplementation(() => ({
    listBookings: mockListBookings,
    getGuest: mockGetGuest,
  })),
}));

vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: mockEnsureConnectionRows,
  STALE_RUNNING_THRESHOLD_MS: 10 * 60 * 1000,
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

const {
  syncOwnerRezReservations,
  previewOwnerRezReservationSync,
  mapOwnerRezBookingStatus,
} = await import("./ownerrez-reservation-sync.service");

const ACTOR = { userId: "user-1" };
const CONNECTION = { id: "conn-1", provider: "OWNERREZ" };

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    property_id: 500,
    guest_id: 9001,
    status: "active",
    arrival: "2026-10-01",
    departure: "2026-10-05",
    guests_adults: 2,
    guests_children: 0,
    guests_pets: 0,
    total_amount: 1200.5,
    created_utc: "2026-09-01T00:00:00Z",
    updated_utc: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const AQUA_PALM = {
  id: "prop-1",
  name: "Aqua Palm",
  ownerRezPropertyId: "500",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureConnectionRows.mockResolvedValue(undefined);
  mockConnectionFindUniqueOrThrow.mockResolvedValue(CONNECTION);
  mockConnectionUpdate.mockResolvedValue({});
  mockSyncLogFindFirst.mockResolvedValue(null);
  mockSyncLogCreate.mockResolvedValue({ id: "log-1" });
  mockSyncLogUpdate.mockResolvedValue({});
  mockRecordAudit.mockResolvedValue({});
  mockQueryRaw.mockResolvedValue([{ locked: true }]);
  mockReservationGuestUpsert.mockResolvedValue({});
  process.env.OWNERREZ_USERNAME = "user";
  process.env.OWNERREZ_API_TOKEN = "token";
});

afterEach(() => {
  delete process.env.OWNERREZ_USERNAME;
  delete process.env.OWNERREZ_API_TOKEN;
});

describe("mapOwnerRezBookingStatus", () => {
  it("maps the real 'active' status to CONFIRMED with no cancelledAt", () => {
    const result = mapOwnerRezBookingStatus({
      status: "active",
      updated_utc: "2026-09-01T00:00:00Z",
    });
    expect(result).toEqual({
      recognized: true,
      status: "CONFIRMED",
      cancelledAt: null,
    });
  });

  it("maps the real 'canceled' status to CANCELLED with cancelledAt from updated_utc", () => {
    const result = mapOwnerRezBookingStatus({
      status: "canceled",
      updated_utc: "2026-09-05T12:00:00Z",
    });
    expect(result.recognized).toBe(true);
    if (result.recognized) {
      expect(result.status).toBe("CANCELLED");
      expect(result.cancelledAt).toEqual(new Date("2026-09-05T12:00:00Z"));
    }
  });

  it("never guesses a mapping for an unrecognized status string", () => {
    const result = mapOwnerRezBookingStatus({
      status: "hold",
      updated_utc: "2026-09-01T00:00:00Z",
    });
    expect(result).toEqual({ recognized: false });
  });
});

describe("syncOwnerRezReservations — first import", () => {
  it("creates a new Reservation + ReservationGuest for a booking never seen before", async () => {
    mockListBookings.mockResolvedValue([booking()]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);
    mockGetGuest.mockResolvedValue({
      id: 9001,
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone: null,
    });
    mockGuestUpsert.mockResolvedValue({ id: "guest-1" });
    mockReservationFindUnique.mockResolvedValue(null);
    mockReservationCreate.mockResolvedValue({ id: "res-1" });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 1,
      updated: 0,
    });
    expect(mockReservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          propertyId: "prop-1",
          primaryGuestId: "guest-1",
          source: "OWNERREZ",
          externalReservationId: "1001",
          status: "CONFIRMED",
        }),
      }),
    );
    expect(mockReservationGuestUpsert).toHaveBeenCalled();
    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });
});

describe("syncOwnerRezReservations — idempotency and updates", () => {
  it("re-running the same booking updates the existing row instead of creating a duplicate", async () => {
    mockListBookings.mockResolvedValue([booking()]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([
      { id: "guest-1", ownerRezGuestId: "9001" },
    ]);
    mockReservationFindUnique.mockResolvedValue({ id: "res-1" });
    mockReservationUpdate.mockResolvedValue({ id: "res-1" });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 0,
      updated: 1,
    });
    expect(mockReservationCreate).not.toHaveBeenCalled();
    expect(mockReservationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "res-1" },
        data: expect.objectContaining({ externalReservationId: "1001" }),
      }),
    );
    // No second guest lookup needed — already-linked guest reused by ownerRezGuestId.
    expect(mockGetGuest).not.toHaveBeenCalled();
  });

  it("a cancelled booking updates status to CANCELLED and sets cancelledAt from the provider's own timestamp", async () => {
    mockListBookings.mockResolvedValue([
      booking({ status: "canceled", updated_utc: "2026-09-10T08:00:00Z" }),
    ]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([
      { id: "guest-1", ownerRezGuestId: "9001" },
    ]);
    mockReservationFindUnique.mockResolvedValue({ id: "res-1" });
    mockReservationUpdate.mockResolvedValue({ id: "res-1" });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ status: "completed", updated: 1 });
    expect(mockReservationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelledAt: new Date("2026-09-10T08:00:00Z"),
        }),
      }),
    );
  });
});

describe("syncOwnerRezReservations — safety: never guesses a property or status", () => {
  it("a booking whose property_id has no linked StayWhile property is skipped and reported, never attached to the wrong property", async () => {
    mockListBookings.mockResolvedValue([booking({ property_id: 999999 })]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]); // only ownerRezPropertyId "500" is linked
    mockGuestFindMany.mockResolvedValue([]);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 0,
      updated: 0,
    });
    if (outcome.status === "completed") {
      expect(outcome.unmatchedProperty).toHaveLength(1);
      expect(outcome.unmatchedProperty[0]).toMatchObject({
        ownerRezPropertyId: 999999,
        propertyName: null,
      });
    }
    expect(mockReservationCreate).not.toHaveBeenCalled();
    expect(mockReservationUpdate).not.toHaveBeenCalled();
  });

  it("a booking with an unrecognized status string is skipped and reported, never coerced into a guessed StayWhile status", async () => {
    mockListBookings.mockResolvedValue([booking({ status: "inquiry" })]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 0,
      updated: 0,
    });
    if (outcome.status === "completed") {
      expect(outcome.unrecognizedStatus).toHaveLength(1);
      expect(outcome.unrecognizedStatus[0]?.status).toBe("inquiry");
    }
    expect(mockReservationCreate).not.toHaveBeenCalled();
  });
});

describe("syncOwnerRezReservations — multiple bookings, same property", () => {
  it("processes several bookings for the same property independently, without cross-contaminating them", async () => {
    mockListBookings.mockResolvedValue([
      booking({ id: 2001, guest_id: 9001 }),
      booking({
        id: 2002,
        guest_id: 9002,
        arrival: "2026-11-01",
        departure: "2026-11-05",
      }),
    ]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);
    mockGetGuest.mockImplementation((id: number) =>
      Promise.resolve({
        id,
        first_name: `Guest${id}`,
        last_name: "Test",
        email: null,
        phone: null,
      }),
    );
    mockGuestUpsert.mockImplementation(
      ({ create }: { create: { ownerRezGuestId: string } }) =>
        Promise.resolve({ id: `guest-${create.ownerRezGuestId}` }),
    );
    mockReservationFindUnique.mockResolvedValue(null);
    mockReservationCreate.mockImplementation(
      ({ data }: { data: { externalReservationId: string } }) =>
        Promise.resolve({ id: `res-${data.externalReservationId}` }),
    );

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 2,
      updated: 0,
    });
    expect(mockReservationCreate).toHaveBeenCalledTimes(2);
    expect(mockReservationCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ externalReservationId: "2001" }),
      }),
    );
    expect(mockReservationCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ externalReservationId: "2002" }),
      }),
    );
  });
});

describe("syncOwnerRezReservations — partial failure reporting", () => {
  it("a guest OwnerRez itself can't resolve is reported per-booking and does not create a reservation with a fabricated guest", async () => {
    mockListBookings.mockResolvedValue([booking({ guest_id: 8000 })]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);
    mockGetGuest.mockRejectedValue(new Error("404 guest not found"));

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 0,
      updated: 0,
    });
    if (outcome.status === "completed") {
      expect(outcome.guestErrors.length).toBeGreaterThan(0);
    }
    expect(mockReservationCreate).not.toHaveBeenCalled();
  });

  it("mutual exclusion: refuses to start a second sync while one is already RUNNING", async () => {
    mockQueryRaw.mockResolvedValue([{ locked: false }]);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toEqual({ status: "already_running" });
    expect(mockListBookings).not.toHaveBeenCalled();
  });

  it("reports a failed sync (e.g. OwnerRez unreachable) via IntegrationSyncLog, never throws out to the caller", async () => {
    mockListBookings.mockRejectedValue(new Error("network unreachable"));

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toEqual({
      status: "failed",
      reason: "network unreachable",
    });
    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "network unreachable",
        }),
      }),
    );
  });
});

describe("previewOwnerRezReservationSync — read-only, never writes", () => {
  it("classifies bookings into create/update/unmatched/unrecognized without writing anything", async () => {
    mockListBookings.mockResolvedValue([
      booking({ id: 3001 }),
      booking({ id: 3002, property_id: 999999 }),
      booking({ id: 3003, status: "hold" }),
    ]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockReservationFindMany.mockResolvedValue([]);

    const result = await previewOwnerRezReservationSync(ACTOR as never);

    expect(result.configured).toBe(true);
    if (result.configured && "plan" in result) {
      expect(result.plan.totalFetched).toBe(3);
      expect(result.plan.toCreate).toHaveLength(1);
      expect(result.plan.unmatchedProperty).toHaveLength(1);
      expect(result.plan.unrecognizedStatus).toHaveLength(1);
    }
    expect(mockReservationCreate).not.toHaveBeenCalled();
    expect(mockGuestUpsert).not.toHaveBeenCalled();
  });

  it("classifies an already-synced booking as an update, not a create", async () => {
    mockListBookings.mockResolvedValue([booking({ id: 4001 })]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockReservationFindMany.mockResolvedValue([
      { externalReservationId: "4001" },
    ]);

    const result = await previewOwnerRezReservationSync(ACTOR as never);

    if (result.configured && "plan" in result) {
      expect(result.plan.toUpdate).toHaveLength(1);
      expect(result.plan.toCreate).toHaveLength(0);
    }
  });

  it("returns configured:false when OwnerRez credentials aren't set", async () => {
    delete process.env.OWNERREZ_USERNAME;
    delete process.env.OWNERREZ_API_TOKEN;

    const result = await previewOwnerRezReservationSync(ACTOR as never);

    expect(result).toEqual({ configured: false });
  });
});
