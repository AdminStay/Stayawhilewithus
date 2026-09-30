import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListBookings,
  mockListOperationalBookings,
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
} = vi.hoisted(() => {
  const mockListBookings = vi.fn();
  return {
    mockListBookings,
    // The service now calls listOperationalBookings(); by default it returns
    // whatever each test configured on mockListBookings, so every existing
    // test exercises the new path unchanged. The retrieval strategy itself is
    // covered in packages/integrations/src/ownerrez/client.test.ts.
    mockListOperationalBookings: vi.fn(async () => {
      const bookings = await mockListBookings();
      return {
        bookings,
        stats: {
          recentChanges: bookings.length,
          stayWindow: 0,
          merged: bookings.length,
          propertiesQueried: 0,
          stayWindowFrom: "2026-09-26",
        },
      };
    }),
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
  };
});

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

const { mockAssertPermission } = vi.hoisted(() => ({
  mockAssertPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@stayw/auth", () => ({
  assertPermission: mockAssertPermission,
}));

vi.mock("@stayw/integrations/ownerrez", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/ownerrez")>();
  return {
    // The real error class, so the service's instanceof checks are genuine.
    OwnerrezRequestBudgetError: actual.OwnerrezRequestBudgetError,
    OwnerrezUnexpectedResponseError: actual.OwnerrezUnexpectedResponseError,
    OwnerrezClient: vi.fn().mockImplementation(() => ({
      listBookings: mockListBookings,
      listOperationalBookings: mockListOperationalBookings,
      getGuest: mockGetGuest,
      usage: { requestsMade: 0, requestBudget: 200, rateLimited: false },
    })),
  };
});

vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: mockEnsureConnectionRows,
  STALE_RUNNING_THRESHOLD_MS: 10 * 60 * 1000,
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

const {
  syncOwnerRezReservations,
  syncOwnerRezReservationsAutomatic,
  previewOwnerRezReservationSync,
  mapOwnerRezBookingStatus,
  classifyOwnerRezRecord,
  OWNERREZ_DEFERRED_MARKER,
  OWNERREZ_RUN_REQUEST_BUDGET,
} = await import("./ownerrez-reservation-sync.service");
const {
  OwnerrezClient,
  OwnerrezRequestBudgetError,
  OwnerrezUnexpectedResponseError,
} = await import("@stayw/integrations/ownerrez");

const ACTOR = { userId: "user-1" };
const CONNECTION = { id: "conn-1", provider: "OWNERREZ" };

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    property_id: 500,
    guest_id: 9001,
    status: "active",
    // A real guest booking, as OwnerRez returns it (2026-09-29).
    type: "booking" as string | undefined,
    is_block: false as boolean | undefined,
    arrival: "2026-10-01",
    departure: "2026-10-05",
    adults: 2,
    children: 0,
    pets: 0,
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

describe("OwnerRez operational retrieval wiring (2026-09-27, OwnerRez step 1)", () => {
  it("sync: a long-lead booking (created/changed 200 days ago, arriving next week) returned by the operational retrieval is imported like any other — same property/guest matching", async () => {
    mockListBookings.mockResolvedValue([
      booking({
        id: 5501,
        arrival: "2026-10-03",
        departure: "2026-10-06",
        created_utc: "2026-03-11T00:00:00Z",
        updated_utc: "2026-03-11T00:00:00Z",
      }),
    ]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);
    mockGetGuest.mockResolvedValue({
      id: 9001,
      first_name: "Jane",
      last_name: "Doe",
      email: null,
      phone: null,
    });
    mockGuestUpsert.mockResolvedValue({ id: "guest-1" });
    mockReservationFindUnique.mockResolvedValue(null);
    mockReservationCreate.mockResolvedValue({ id: "res-1" });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ status: "completed", created: 1 });
    expect(mockListOperationalBookings).toHaveBeenCalledTimes(1);
    expect(mockListBookings).toHaveBeenCalledTimes(1); // only via the operational wrapper
    expect(mockReservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          propertyId: "prop-1",
          externalReservationId: "5501",
        }),
      }),
    );
  });

  it("preview uses the operational retrieval too, and still never writes", async () => {
    mockListBookings.mockResolvedValue([booking({ id: 5601 })]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockReservationFindMany.mockResolvedValue([]);

    const result = await previewOwnerRezReservationSync(ACTOR as never);

    expect(mockListOperationalBookings).toHaveBeenCalledTimes(1);
    if (result.configured && "plan" in result) {
      expect(result.plan.totalFetched).toBe(1);
      expect(result.plan.toCreate).toHaveLength(1);
    }
    expect(mockReservationCreate).not.toHaveBeenCalled();
    expect(mockGuestUpsert).not.toHaveBeenCalled();
  });
});

describe("OwnerRez first-sync rate-limit safety (2026-09-28)", () => {
  const guestRecord = (id: number) => ({
    id,
    first_name: `G${id}`,
    last_name: "Test",
    email: null,
    phone: null,
  });

  function setup(bookings: ReturnType<typeof booking>[]) {
    mockListBookings.mockResolvedValue(bookings);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);
    mockGuestUpsert.mockImplementation(async ({ create }) => ({
      id: `guest-${create.ownerRezGuestId}`,
    }));
    mockReservationFindUnique.mockResolvedValue(null);
    mockReservationCreate.mockResolvedValue({ id: "res" });
  }

  it("every run's client gets the per-run request budget (below OwnerRez's documented 300 / 5 min)", async () => {
    setup([booking()]);
    mockGetGuest.mockImplementation(async (id: number) => guestRecord(id));
    await syncOwnerRezReservations(ACTOR as never);
    await previewOwnerRezReservationSync(ACTOR as never);
    expect(OWNERREZ_RUN_REQUEST_BUDGET).toBeLessThan(300);
    for (const call of vi.mocked(OwnerrezClient).mock.calls) {
      expect(call[1]).toEqual({ requestBudget: OWNERREZ_RUN_REQUEST_BUDGET });
    }
  });

  it("de-duplicates guest lookups: one GET per distinct guest, none for guests already in StayWhile", async () => {
    setup([
      booking({ id: 1, guest_id: 10 }),
      booking({ id: 2, guest_id: 10 }),
      booking({ id: 3, guest_id: 11 }),
      booking({ id: 4, guest_id: 12 }),
    ]);
    mockGuestFindMany.mockResolvedValue([
      { id: "existing-12", ownerRezGuestId: "12" },
    ]);
    mockGetGuest.mockImplementation(async (id: number) => guestRecord(id));

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(mockGetGuest.mock.calls.map((c) => c[0]).sort()).toEqual([10, 11]);
    expect(outcome).toMatchObject({ status: "completed", created: 4 });
  });

  it("never spends a guest lookup on bookings that won't be written (unmatched property / unrecognized status)", async () => {
    setup([
      booking({ id: 1, guest_id: 20 }),
      booking({ id: 2, guest_id: 21, property_id: 999999 }),
      booking({ id: 3, guest_id: 22, status: "hold" }),
    ]);
    mockGetGuest.mockImplementation(async (id: number) => guestRecord(id));

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(mockGetGuest.mock.calls.map((c) => c[0])).toEqual([20]);
    expect(outcome).toMatchObject({ created: 1 });
    if (outcome.status === "completed") {
      expect(outcome.unmatchedProperty).toHaveLength(1);
      expect(outcome.unrecognizedStatus).toHaveLength(1);
    }
  });

  it("budget reached: remaining bookings are DEFERRED (not errors, nothing fabricated), the run is PARTIAL with the marker, lastSyncedAt is not bumped", async () => {
    setup([booking({ id: 1, guest_id: 30 }), booking({ id: 2, guest_id: 31 })]);
    mockGetGuest.mockImplementation(async (id: number) => {
      if (id === 31) throw new OwnerrezRequestBudgetError("BUDGET_EXHAUSTED");
      return guestRecord(id);
    });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 1,
      guestErrors: [],
    });
    if (outcome.status === "completed") {
      expect(outcome.guestDeferred).toEqual([
        expect.objectContaining({ ownerRezBookingId: 2 }),
      ]);
      expect(Date.parse(outcome.deferredUntil!) - Date.now()).toBeGreaterThan(
        4 * 60_000,
      );
    }
    expect(mockReservationCreate).toHaveBeenCalledTimes(1);
    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PARTIAL",
          errorMessage: expect.stringMatching(
            new RegExp(`^${OWNERREZ_DEFERRED_MARKER}: 1 booking`),
          ),
        }),
      }),
    );
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });

  it("a 429 stops further guest lookups for the rest of the run (no retries); remaining guests are deferred", async () => {
    setup(
      Array.from({ length: 12 }, (_, i) =>
        booking({ id: 100 + i, guest_id: 200 + i }),
      ),
    );
    let calls = 0;
    mockGetGuest.mockImplementation(async (id: number) => {
      calls++;
      if (calls === 3) throw new OwnerrezRequestBudgetError("RATE_LIMITED");
      return guestRecord(id);
    });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    // First batch of 5 was in flight; nothing after it was requested.
    expect(mockGetGuest).toHaveBeenCalledTimes(5);
    if (outcome.status === "completed") {
      expect(outcome.created).toBe(4);
      expect(outcome.guestDeferred).toHaveLength(8);
      expect(outcome.guestErrors).toEqual([]);
    }
  });

  it("operational priority: upcoming/in-house guests are looked up before past-stay guests", async () => {
    setup([
      booking({
        id: 1,
        guest_id: 40,
        arrival: "2020-01-01",
        departure: "2020-01-05",
      }),
      booking({
        id: 2,
        guest_id: 41,
        arrival: "2099-03-01",
        departure: "2099-03-04",
      }),
      booking({
        id: 3,
        guest_id: 42,
        arrival: "2099-01-01",
        departure: "2099-01-04",
      }),
    ]);
    mockGetGuest.mockImplementation(async (id: number) => guestRecord(id));

    await syncOwnerRezReservations(ACTOR as never);

    expect(mockGetGuest.mock.calls.map((c) => c[0])).toEqual([42, 41, 40]);
  });

  it("cooldown: within 5 minutes of a deferred/rate-limited run, a new sync is refused before any OwnerRez request or log row", async () => {
    mockSyncLogFindFirst.mockImplementation(
      async ({ where }: { where: { errorMessage?: unknown } }) =>
        where.errorMessage
          ? { finishedAt: new Date(Date.now() - 60_000) }
          : null,
    );

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toEqual({
      status: "cooldown",
      cooldownUntil: expect.any(String),
    });
    expect(mockListBookings).not.toHaveBeenCalled();
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
  });

  it("the budget/rate limit hit while fetching bookings fails the run cleanly with the marker (starts the cooldown) and writes nothing", async () => {
    mockListBookings.mockRejectedValue(
      new OwnerrezRequestBudgetError("RATE_LIMITED"),
    );

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome.status).toBe("failed");
    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringMatching(
            new RegExp(`^${OWNERREZ_DEFERRED_MARKER}: `),
          ),
        }),
      }),
    );
    expect(mockReservationCreate).not.toHaveBeenCalled();
  });

  it("idempotent follow-up: on the next run the guest created earlier is reused (no lookup) and the deferred booking is written once", async () => {
    setup([booking({ id: 2, guest_id: 31 })]);
    mockGuestFindMany.mockResolvedValue([
      { id: "guest-31", ownerRezGuestId: "31" },
    ]);
    mockGetGuest.mockImplementation(async (id: number) => guestRecord(id));

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(mockGetGuest).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "completed", created: 1 });
    if (outcome.status === "completed") {
      expect(outcome.guestDeferred).toEqual([]);
    }
    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });
});

describe("previewOwnerRezReservationSync — ZERO StayWhile writes, proven (2026-09-28, Preview UI)", () => {
  it("a preview touches no write path at all: no Guest/Reservation/link writes, no IntegrationConnection or IntegrationSyncLog row, no audit, no transaction, no connection-row upsert", async () => {
    mockListBookings.mockResolvedValue([
      booking({ id: 9101 }),
      booking({ id: 9102, property_id: 999999 }),
      booking({ id: 9103, status: "hold" }),
    ]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockReservationFindMany.mockResolvedValue([
      { externalReservationId: "9101" },
    ]);
    const { prisma } = await import("@stayw/database");

    const result = await previewOwnerRezReservationSync(ACTOR as never);

    expect(result.configured && "plan" in result).toBe(true);
    for (const write of [
      mockGuestUpsert,
      mockReservationCreate,
      mockReservationUpdate,
      mockReservationGuestUpsert,
      mockSyncLogCreate,
      mockSyncLogUpdate,
      mockConnectionUpdate,
      mockConnectionFindUniqueOrThrow,
      mockEnsureConnectionRows,
      mockRecordAudit,
      mockGetGuest,
      mockQueryRaw,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("source-level: the preview function body contains no write or audit call", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "./ownerrez-reservation-sync.service.ts",
      ),
      "utf8",
    );
    const start = source.indexOf(
      "export async function previewOwnerRezReservationSync",
    );
    const end = source.indexOf("\nexport ", start + 10);
    const body = source.slice(start, end);
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$queryRaw|\$executeRaw|ensureConnectionRows|recordAudit|syncOwnerRezReservations/,
    );
  });

  it("a long-lead upcoming stay (booked and last changed 200 days ago) appears in the preview as a create", async () => {
    mockListBookings.mockResolvedValue([
      booking({
        id: 9201,
        arrival: "2099-01-10",
        departure: "2099-01-14",
        created_utc: "2098-06-24T00:00:00Z",
        updated_utc: "2098-06-24T00:00:00Z",
      }),
    ]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockReservationFindMany.mockResolvedValue([]);

    const result = await previewOwnerRezReservationSync(ACTOR as never);

    expect(mockListOperationalBookings).toHaveBeenCalledTimes(1);
    if (result.configured && "plan" in result) {
      expect(result.plan.toCreate.map((i) => i.ownerRezBookingId)).toEqual([
        9201,
      ]);
    } else {
      throw new Error("expected a plan");
    }
  });

  it("preview runs under the same per-run OwnerRez request budget as the sync", async () => {
    mockListBookings.mockResolvedValue([]);
    mockPropertyFindMany.mockResolvedValue([]);
    mockReservationFindMany.mockResolvedValue([]);
    await previewOwnerRezReservationSync(ACTOR as never);
    expect(vi.mocked(OwnerrezClient).mock.calls.at(-1)?.[1]).toEqual({
      requestBudget: OWNERREZ_RUN_REQUEST_BUDGET,
    });
  });
});

describe("preview — undocumented OwnerRez response shape (2026-09-28 diagnostic)", () => {
  const diagnostic = {
    operation: "bookings:stay-window" as const,
    page: 1,
    batch: 1,
    type: "object" as const,
    keys: ["message", "status"],
  };

  it("fails visibly (never '0 bookings'), ends with 'Nothing was written to StayWhile.', and logs only the safe diagnostic", async () => {
    mockListOperationalBookings.mockRejectedValueOnce(
      new OwnerrezUnexpectedResponseError(diagnostic),
    );
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await previewOwnerRezReservationSync(ACTOR as never);

      expect(result).toEqual({
        configured: true,
        error:
          "OwnerRez returned an unexpected response for bookings:stay-window (page 1, batch 1): object with keys [message, status]. Nothing was written to StayWhile.",
      });
      const call = log.mock.calls.find((c) =>
        String(c[1]).includes("preview_unexpected_response"),
      );
      expect(call?.[0]).toBe("[ownerrez-reservation-sync]");
      expect(JSON.parse(String(call?.[1]))).toMatchObject({
        event: "preview_unexpected_response",
        ...diagnostic,
      });
    } finally {
      log.mockRestore();
    }
  });

  it("the failure path writes nothing either", async () => {
    mockListOperationalBookings.mockRejectedValueOnce(
      new OwnerrezUnexpectedResponseError(diagnostic),
    );
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    const { prisma } = await import("@stayw/database");

    await previewOwnerRezReservationSync(ACTOR as never);

    for (const write of [
      mockGuestUpsert,
      mockReservationCreate,
      mockReservationUpdate,
      mockReservationGuestUpsert,
      mockSyncLogCreate,
      mockSyncLogUpdate,
      mockConnectionUpdate,
      mockEnsureConnectionRows,
      mockRecordAudit,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("any other preview failure also ends with 'Nothing was written to StayWhile.'", async () => {
    mockListOperationalBookings.mockRejectedValueOnce(
      new OwnerrezRequestBudgetError("RATE_LIMITED"),
    );
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    const result = await previewOwnerRezReservationSync(ACTOR as never);
    expect(result).toMatchObject({
      error: expect.stringMatching(/Nothing was written to StayWhile\.$/),
    });
  });
});

describe("sync reporting never contains guest ids (2026-09-28)", () => {
  const SYNTHETIC_GUEST_ID = 987654;

  async function runAndCapture() {
    const logs: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => logs.push(args.map(String).join(" ")));
    try {
      const outcome = await syncOwnerRezReservations(ACTOR as never);
      return { outcome, emitted: JSON.stringify(outcome) + logs.join("\n") };
    } finally {
      log.mockRestore();
    }
  }

  beforeEach(() => {
    mockListBookings.mockResolvedValue([
      booking({ id: 1, guest_id: SYNTHETIC_GUEST_ID }),
    ]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);
    mockReservationFindUnique.mockResolvedValue(null);
  });

  it("a failed guest lookup is reported and logged without the guest id", async () => {
    const { HttpRequestError } = await import("@stayw/integrations/core");
    mockGetGuest.mockRejectedValue(
      new HttpRequestError("OwnerRez guest lookup", 404),
    );
    const { outcome, emitted } = await runAndCapture();
    expect(outcome).toMatchObject({ status: "completed", created: 0 });
    if (outcome.status === "completed") {
      expect(outcome.guestErrors[0]?.reason).toBe(
        "Guest could not be resolved — reservation skipped.",
      );
    }
    expect(emitted).not.toContain(String(SYNTHETIC_GUEST_ID));
  });

  it("a guest save failure (DB error text containing the id) reports a fixed reason and logs only the error class", async () => {
    mockGetGuest.mockResolvedValue({
      id: SYNTHETIC_GUEST_ID,
      first_name: "Synthetic",
      last_name: "Guest",
      email: null,
      phone: null,
    });
    mockGuestUpsert.mockRejectedValue(
      new Error(
        `Unique constraint failed on ownerRezGuestId=${SYNTHETIC_GUEST_ID}`,
      ),
    );
    const { outcome, emitted } = await runAndCapture();
    if (outcome.status === "completed") {
      expect(outcome.guestErrors.map((e) => e.reason)).toContain(
        "A guest record could not be saved.",
      );
    }
    expect(emitted).not.toContain(String(SYNTHETIC_GUEST_ID));
    expect(emitted).not.toContain("Unique constraint");
  });

  it("a deferred booking's reason has no guest id", async () => {
    mockGetGuest.mockRejectedValue(
      new OwnerrezRequestBudgetError("BUDGET_EXHAUSTED"),
    );
    const { outcome, emitted } = await runAndCapture();
    if (outcome.status === "completed") {
      expect(outcome.guestDeferred[0]?.reason).toBe(
        "Guest not looked up yet (OwnerRez request limit for this run) — deferred to the next sync.",
      );
    }
    expect(emitted).not.toContain(String(SYNTHETIC_GUEST_ID));
  });
});

describe("OwnerRez guest-booking eligibility — pre-first-sync safety (2026-09-29)", () => {
  const guestRecord = (id: number) => ({
    id,
    first_name: `G${id}`,
    last_name: "Test",
    email: null,
    phone: null,
  });

  function setup(bookings: ReturnType<typeof booking>[]) {
    mockListBookings.mockResolvedValue(bookings);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([]);
    mockGuestUpsert.mockImplementation(async ({ create }) => ({
      id: `guest-${create.ownerRezGuestId}`,
    }));
    mockReservationFindUnique.mockResolvedValue(null);
    mockReservationFindMany.mockResolvedValue([]);
    mockReservationCreate.mockResolvedValue({ id: "res" });
    mockGetGuest.mockImplementation(async (id: number) => guestRecord(id));
  }

  // Shaped like OwnerRez #17031650: an "active" block with no guest,
  // returned by /bookings exactly like a stay — here on a LINKED property,
  // the case that would otherwise reach the import.
  const blockLike17031650 = () =>
    booking({
      id: 17031650,
      type: "block",
      is_block: true,
      status: "active",
      guest_id: 0,
      arrival: "2026-10-18",
      departure: "2026-10-24",
      adults: 0,
      children: 0,
      pets: 0,
    });

  describe("classifyOwnerRezRecord", () => {
    it("type=booking, is_block=false → eligible guest booking", () => {
      expect(
        classifyOwnerRezRecord({ type: "booking", is_block: false }),
      ).toEqual({ guestBooking: true });
    });

    it("is_block=true → excluded as blocked-off time even when type is booking", () => {
      expect(
        classifyOwnerRezRecord({ type: "booking", is_block: true }),
      ).toEqual({ guestBooking: false, kind: "block" });
    });

    it.each([
      ["block", "block"],
      ["quote_hold", "quote_hold"],
      ["linked_availability", "linked_availability"],
      ["owner", "owner"],
    ] as const)("type=%s → excluded as %s", (type, kind) => {
      expect(classifyOwnerRezRecord({ type, is_block: true })).toEqual({
        guestBooking: false,
        kind,
      });
      expect(classifyOwnerRezRecord({ type, is_block: false })).toEqual({
        guestBooking: false,
        kind,
      });
    });

    it("missing or unknown type fails closed (excluded as unknown), never treated as a guest booking", () => {
      for (const type of [undefined, "", "Booking", "reservation", "hold"]) {
        expect(classifyOwnerRezRecord({ type, is_block: false })).toEqual({
          guestBooking: false,
          kind: "unknown",
        });
      }
    });
  });

  it("an active block on a linked property (shaped like #17031650) is not imported and gets no guest lookup", async () => {
    setup([blockLike17031650()]);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 0,
      updated: 0,
    });
    if (outcome.status === "completed") {
      expect(outcome.nonGuest).toEqual({
        block: 1,
        quote_hold: 0,
        linked_availability: 0,
        owner: 0,
        unknown: 0,
      });
      // Not a false "guest could not be resolved" error either.
      expect(outcome.guestErrors).toHaveLength(0);
      expect(outcome.unmatchedProperty).toHaveLength(0);
    }
    expect(mockGetGuest).not.toHaveBeenCalled();
    expect(mockGuestFindMany).toHaveBeenCalledWith({
      where: { ownerRezGuestId: { in: [] } },
      select: { id: true, ownerRezGuestId: true },
    });
    expect(mockGuestUpsert).not.toHaveBeenCalled();
    expect(mockReservationCreate).not.toHaveBeenCalled();
    expect(mockReservationUpdate).not.toHaveBeenCalled();
  });

  it("is_block=true with status active is excluded even if a guest_id is present", async () => {
    setup([booking({ id: 7001, is_block: true, guest_id: 555 })]);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ created: 0 });
    expect(mockGetGuest).not.toHaveBeenCalled();
    expect(mockReservationCreate).not.toHaveBeenCalled();
  });

  it("mixed run: only the real guest booking imports; every non-guest kind is skipped, counted by kind, and never looked up", async () => {
    setup([
      booking({ id: 1, guest_id: 10 }),
      booking({ id: 2, guest_id: 11, type: "block", is_block: true }),
      booking({ id: 3, guest_id: 12, type: "quote_hold", is_block: true }),
      booking({
        id: 4,
        guest_id: 13,
        type: "linked_availability",
        is_block: true,
      }),
      booking({ id: 5, guest_id: 14, type: "owner", is_block: false }),
      booking({ id: 6, guest_id: 15, type: undefined }),
      booking({ id: 7, guest_id: 16, type: "something_new" }),
    ]);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ status: "completed", created: 1 });
    if (outcome.status === "completed") {
      expect(outcome.nonGuest).toEqual({
        block: 1,
        quote_hold: 1,
        linked_availability: 1,
        owner: 1,
        unknown: 2,
      });
    }
    expect(mockGetGuest.mock.calls.map((c) => c[0])).toEqual([10]);
    expect(mockReservationCreate).toHaveBeenCalledTimes(1);
    expect(mockReservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalReservationId: "1" }),
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          nonGuestSkipped: {
            block: 1,
            quote_hold: 1,
            linked_availability: 1,
            owner: 1,
            unknown: 2,
          },
        }),
      }),
    );
  });

  it("a real booking imports OwnerRez's actual adults/children/pets unchanged", async () => {
    setup([booking({ adults: 3, children: 2, pets: 1 })]);

    await syncOwnerRezReservations(ACTOR as never);

    expect(mockReservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adults: 3, children: 2, pets: 1 }),
      }),
    );
  });

  it("a present valid count of 0 is written as 0, never replaced by a default", async () => {
    setup([booking({ adults: 0, children: 0, pets: 0 })]);

    await syncOwnerRezReservations(ACTOR as never);

    expect(mockReservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adults: 0, children: 0, pets: 0 }),
      }),
    );
  });

  it("a missing or invalid count is left unset (DB default on create / unchanged on update), never guessed", async () => {
    setup([booking({ adults: undefined, children: -1, pets: 1.5 })]);

    await syncOwnerRezReservations(ACTOR as never);

    const data = mockReservationCreate.mock.calls[0]![0].data;
    expect(data.adults).toBeUndefined();
    expect(data.children).toBeUndefined();
    expect(data.pets).toBeUndefined();
  });

  it("a cancelled real guest booking is still imported as CANCELLED with its real counts", async () => {
    setup([
      booking({
        status: "canceled",
        updated_utc: "2026-08-23T11:43:27Z",
        adults: 4,
        children: 1,
        pets: 0,
      }),
    ]);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ created: 1 });
    expect(mockReservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelledAt: new Date("2026-08-23T11:43:27Z"),
          adults: 4,
          children: 1,
          pets: 0,
        }),
      }),
    );
  });

  it("preview: non-guest records go to their own bucket (not create/update/unmatched/unrecognized), with zero writes and no guest lookup", async () => {
    setup([
      booking({ id: 1 }),
      blockLike17031650(),
      booking({ id: 3, type: "block", is_block: true, property_id: 999999 }),
      booking({ id: 4, type: "owner", is_block: false }),
      booking({ id: 5, type: undefined, is_block: undefined }),
      booking({ id: 6, property_id: 999999 }),
      booking({ id: 7, status: "hold" }),
    ]);

    const result = await previewOwnerRezReservationSync(ACTOR as never);

    if (!(result.configured && "plan" in result)) {
      throw new Error("expected a plan");
    }
    const { plan } = result;
    expect(plan.totalFetched).toBe(7);
    expect(plan.toCreate.map((i) => i.ownerRezBookingId)).toEqual([1]);
    expect(plan.unmatchedProperty.map((i) => i.ownerRezBookingId)).toEqual([6]);
    expect(plan.unrecognizedStatus.map((i) => i.ownerRezBookingId)).toEqual([
      7,
    ]);
    expect(plan.nonGuest.map((i) => [i.ownerRezBookingId, i.kind])).toEqual([
      [17031650, "block"],
      [3, "block"],
      [4, "owner"],
      [5, "unknown"],
    ]);
    for (const write of [
      mockGuestUpsert,
      mockReservationCreate,
      mockReservationUpdate,
      mockReservationGuestUpsert,
      mockSyncLogCreate,
      mockSyncLogUpdate,
      mockRecordAudit,
      mockGetGuest,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});

describe("unchanged-row skip (2026-09-30)", () => {
  // Exactly what Prisma returns for a row the sync wrote from booking().
  const storedRow = {
    id: "res-1",
    propertyId: "prop-1",
    primaryGuestId: "guest-1",
    status: "CONFIRMED",
    checkInDate: new Date("2026-10-01T00:00:00.000Z"),
    checkOutDate: new Date("2026-10-05T00:00:00.000Z"),
    adults: 2,
    children: 0,
    pets: 0,
    totalAmount: { toString: () => "1200.50" },
    cancelledAt: null,
    reservationGuests: [{ guestId: "guest-1" }],
  };

  beforeEach(() => {
    mockListBookings.mockResolvedValue([booking()]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([
      { id: "guest-1", ownerRezGuestId: "9001" },
    ]);
  });

  it("an identical existing reservation is counted unchanged and NOT written", async () => {
    mockReservationFindUnique.mockResolvedValue(storedRow);

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({
      status: "completed",
      created: 0,
      updated: 0,
      unchanged: 1,
    });
    expect(mockReservationUpdate).not.toHaveBeenCalled();
    expect(mockReservationCreate).not.toHaveBeenCalled();
    expect(mockReservationGuestUpsert).not.toHaveBeenCalled();
    // Still a complete run: SUCCEEDED + lastSyncedAt bumped.
    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          recordsProcessed: 0,
        }),
      }),
    );
    expect(mockConnectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
      }),
    );
  });

  it("the lookup asks for the compared fields and only this guest's link", async () => {
    mockReservationFindUnique.mockResolvedValue(storedRow);
    await syncOwnerRezReservations(ACTOR as never);
    expect(mockReservationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          totalAmount: true,
          cancelledAt: true,
          reservationGuests: expect.objectContaining({
            where: { guestId: "guest-1" },
          }),
        }),
      }),
    );
  });

  it("an OwnerRez change (e.g. guest count) is still written as an update", async () => {
    mockListBookings.mockResolvedValue([booking({ adults: 4 })]);
    mockReservationFindUnique.mockResolvedValue(storedRow);
    mockReservationUpdate.mockResolvedValue({ id: "res-1" });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ updated: 1, unchanged: 0 });
    expect(mockReservationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "res-1" },
        data: expect.objectContaining({ adults: 4 }),
      }),
    );
  });

  it("a cancellation in OwnerRez is written, not skipped", async () => {
    mockListBookings.mockResolvedValue([
      booking({ status: "canceled", updated_utc: "2026-09-30T08:00:00Z" }),
    ]);
    mockReservationFindUnique.mockResolvedValue(storedRow);
    mockReservationUpdate.mockResolvedValue({ id: "res-1" });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ updated: 1, unchanged: 0 });
  });

  it("a missing primary-guest link is repaired (update + link upsert)", async () => {
    mockReservationFindUnique.mockResolvedValue({
      ...storedRow,
      reservationGuests: [],
    });
    mockReservationUpdate.mockResolvedValue({ id: "res-1" });

    const outcome = await syncOwnerRezReservations(ACTOR as never);

    expect(outcome).toMatchObject({ updated: 1, unchanged: 0 });
    expect(mockReservationGuestUpsert).toHaveBeenCalledTimes(1);
  });

  it("the audit entry records the unchanged count", async () => {
    mockReservationFindUnique.mockResolvedValue(storedRow);
    await syncOwnerRezReservations(ACTOR as never);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({ unchanged: 1, updated: 0 }),
      }),
    );
  });
});

describe("automatic entry point + kill switch (2026-09-30)", () => {
  afterEach(() => {
    delete process.env.OWNERREZ_AUTO_SYNC_ENABLED;
  });

  it.each([undefined, "false", "1", "TRUE"])(
    "OWNERREZ_AUTO_SYNC_ENABLED=%s → disabled, with no database or OwnerRez call at all",
    async (value) => {
      if (value === undefined) delete process.env.OWNERREZ_AUTO_SYNC_ENABLED;
      else process.env.OWNERREZ_AUTO_SYNC_ENABLED = value;

      const outcome = await syncOwnerRezReservationsAutomatic();

      expect(outcome).toEqual({ status: "disabled" });
      expect(mockEnsureConnectionRows).not.toHaveBeenCalled();
      expect(mockConnectionFindUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockQueryRaw).not.toHaveBeenCalled();
      expect(mockSyncLogCreate).not.toHaveBeenCalled();
      expect(OwnerrezClient).not.toHaveBeenCalled();
      expect(mockListOperationalBookings).not.toHaveBeenCalled();
      expect(mockRecordAudit).not.toHaveBeenCalled();
    },
  );

  it("enabled → the same guarded run, audited as SYSTEM with no user", async () => {
    process.env.OWNERREZ_AUTO_SYNC_ENABLED = "true";
    mockListBookings.mockResolvedValue([booking()]);
    mockPropertyFindMany.mockResolvedValue([AQUA_PALM]);
    mockGuestFindMany.mockResolvedValue([
      { id: "guest-1", ownerRezGuestId: "9001" },
    ]);
    mockReservationFindUnique.mockResolvedValue(null);
    mockReservationCreate.mockResolvedValue({ id: "res-new" });

    const outcome = await syncOwnerRezReservationsAutomatic();

    expect(outcome).toMatchObject({ status: "completed", created: 1 });
    // Same advisory lock + RUNNING log as the manual path.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockSyncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "Reservation",
          status: "RUNNING",
        }),
      }),
    );
    expect(OwnerrezClient).toHaveBeenCalledWith(expect.anything(), {
      requestBudget: OWNERREZ_RUN_REQUEST_BUDGET,
    });
    expect(mockAssertPermission).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: undefined,
        actorType: "SYSTEM",
        afterState: expect.objectContaining({ trigger: "automatic" }),
      }),
    );
  });

  it("enabled → shares the manual sync's cooldown after a deferred run", async () => {
    process.env.OWNERREZ_AUTO_SYNC_ENABLED = "true";
    const finishedAt = new Date(Date.now() - 60 * 1000);
    mockSyncLogFindFirst
      .mockResolvedValueOnce(null) // no RUNNING row
      .mockResolvedValueOnce({ finishedAt }); // deferred run 1 min ago

    const outcome = await syncOwnerRezReservationsAutomatic();

    expect(outcome).toMatchObject({ status: "cooldown" });
    expect(OwnerrezClient).not.toHaveBeenCalled();
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
  });

  it("enabled → yields to a run already holding the lock", async () => {
    process.env.OWNERREZ_AUTO_SYNC_ENABLED = "true";
    mockQueryRaw.mockResolvedValueOnce([{ locked: false }]);

    const outcome = await syncOwnerRezReservationsAutomatic();

    expect(outcome).toEqual({ status: "already_running" });
    expect(OwnerrezClient).not.toHaveBeenCalled();
  });

  it("the manual Sync still checks reservations:update and is audited as USER/manual", async () => {
    mockListBookings.mockResolvedValue([]);
    mockPropertyFindMany.mockResolvedValue([]);
    mockGuestFindMany.mockResolvedValue([]);

    await syncOwnerRezReservations(ACTOR as never);

    expect(mockAssertPermission).toHaveBeenCalledWith(
      ACTOR,
      "reservations:update",
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        actorType: "USER",
        afterState: expect.objectContaining({ trigger: "manual" }),
      }),
    );
  });
});
