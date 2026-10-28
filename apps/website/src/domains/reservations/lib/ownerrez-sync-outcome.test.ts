import { describe, expect, it } from "vitest";

import {
  classifyOwnerRezSyncResult,
  describeOwnerRezSyncExceptions,
  describeOwnerRezSyncFailure,
  parseOwnerRezSyncExceptions,
} from "./ownerrez-sync-outcome";

const MARKER = "OWNERREZ_DEFERRED";

/** The afterState shape runOwnerRezReservationSync() saves (2026-09-30 →). */
const auditState = (over: Record<string, unknown> = {}) => ({
  trigger: "automatic",
  created: 0,
  updated: 0,
  unchanged: 762,
  unmatchedPropertyCount: 0,
  unrecognizedStatusCount: 0,
  nonGuestSkipped: { block: 185, owner: 0 },
  guestErrorCount: 0,
  guestDeferredCount: 0,
  ownerRezRequestCount: 73,
  ...over,
});

describe("parseOwnerRezSyncExceptions", () => {
  it("reads the saved counts", () => {
    expect(
      parseOwnerRezSyncExceptions(
        auditState({
          unmatchedPropertyCount: 1,
          guestErrorCount: 2,
          unrecognizedStatusCount: 3,
          guestDeferredCount: 4,
        }),
      ),
    ).toEqual({
      unmatchedProperty: 1,
      guestErrors: 2,
      unrecognizedStatus: 3,
      deferred: 4,
    });
  });

  it("no entry, or an entry with none of the counts → null", () => {
    expect(parseOwnerRezSyncExceptions(null)).toBeNull();
    expect(parseOwnerRezSyncExceptions({ created: 4 })).toBeNull();
    expect(parseOwnerRezSyncExceptions([1, 2])).toBeNull();
    expect(parseOwnerRezSyncExceptions("x")).toBeNull();
  });

  it("a missing or malformed field is unknown (null), never 0", () => {
    expect(
      parseOwnerRezSyncExceptions({
        unmatchedPropertyCount: 1,
        guestErrorCount: "2",
        unrecognizedStatusCount: -1,
      }),
    ).toEqual({
      unmatchedProperty: 1,
      guestErrors: null,
      unrecognizedStatus: null,
      deferred: null,
    });
  });
});

describe("classifyOwnerRezSyncResult", () => {
  it("clean only when every skip count is recorded and zero", () => {
    expect(
      classifyOwnerRezSyncResult(parseOwnerRezSyncExceptions(auditState())),
    ).toBe("clean");
  });

  it.each([
    ["unmatchedPropertyCount", 1],
    ["guestErrorCount", 1],
    ["unrecognizedStatusCount", 1],
  ])("%s > 0 → with_exceptions", (field, n) => {
    expect(
      classifyOwnerRezSyncResult(
        parseOwnerRezSyncExceptions(auditState({ [field]: n })),
      ),
    ).toBe("with_exceptions");
  });

  it("missing counts are not claimed clean", () => {
    expect(classifyOwnerRezSyncResult(null)).toBe("unknown");
    expect(
      classifyOwnerRezSyncResult(
        parseOwnerRezSyncExceptions({ unmatchedPropertyCount: 0 }),
      ),
    ).toBe("unknown");
  });

  it("a known exception counts even when other fields are missing", () => {
    expect(
      classifyOwnerRezSyncResult(
        parseOwnerRezSyncExceptions({ guestErrorCount: 2 }),
      ),
    ).toBe("with_exceptions");
  });

  it("deferred alone is not an exception (the PARTIAL status covers it)", () => {
    expect(
      classifyOwnerRezSyncResult(
        parseOwnerRezSyncExceptions(auditState({ guestDeferredCount: 9 })),
      ),
    ).toBe("clean");
  });
});

describe("describeOwnerRezSyncExceptions", () => {
  it("bookings not synced: one sentence, only recorded non-zero counts, singular/plural", () => {
    expect(
      describeOwnerRezSyncExceptions({
        unmatchedProperty: 1,
        guestErrors: 0,
        unrecognizedStatus: 3,
        deferred: 5,
      }),
    ).toEqual([
      "Not synced: 1 booking on an OwnerRez property not linked in StayWhile, 3 bookings with an unrecognized OwnerRez status.",
    ]);
    expect(
      describeOwnerRezSyncExceptions({
        unmatchedProperty: 2,
        guestErrors: null,
        unrecognizedStatus: null,
        deferred: null,
      }),
    ).toEqual([
      "Not synced: 2 bookings on an OwnerRez property not linked in StayWhile.",
    ]);
  });

  it("guest errors are reported as errors, never as a number of bookings", () => {
    const sentences = describeOwnerRezSyncExceptions({
      unmatchedProperty: 0,
      guestErrors: 3,
      unrecognizedStatus: 0,
      deferred: 0,
    });
    expect(sentences).toEqual([
      "3 guest errors — bookings for the affected guests weren't synced.",
    ]);
    expect(sentences.join(" ")).not.toMatch(/\d+ bookings?/);
    expect(
      describeOwnerRezSyncExceptions({
        unmatchedProperty: 1,
        guestErrors: 1,
        unrecognizedStatus: null,
        deferred: null,
      }),
    ).toEqual([
      "Not synced: 1 booking on an OwnerRez property not linked in StayWhile.",
      "1 guest error — bookings for the affected guests weren't synced.",
    ]);
  });

  it("nothing recorded above zero → no sentences", () => {
    expect(
      describeOwnerRezSyncExceptions({
        unmatchedProperty: 0,
        guestErrors: null,
        unrecognizedStatus: 0,
        deferred: 7,
      }),
    ).toEqual([]);
  });
});

describe("describeOwnerRezSyncFailure", () => {
  it("no stored message → null", () => {
    expect(describeOwnerRezSyncFailure(null, MARKER)).toBeNull();
    expect(describeOwnerRezSyncFailure("", MARKER)).toBeNull();
  });

  it("HTTP failures keep only the integer status, never the path", () => {
    const authFail = describeOwnerRezSyncFailure(
      "Request to OwnerRez bookings:recent (page 1) failed with 401",
      MARKER,
    );
    expect(authFail).toBe(
      "OwnerRez refused StayWhile's credentials (HTTP 401).",
    );
    expect(
      describeOwnerRezSyncFailure(
        "Request to /bookings?since_utc=2026-07-30T00:00:00.000Z failed with 503",
        MARKER,
      ),
    ).toBe("OwnerRez had a server error (HTTP 503).");
    expect(
      describeOwnerRezSyncFailure(
        "Request to OwnerRez properties (page 2) failed with 404",
        MARKER,
      ),
    ).toBe("An OwnerRez request was refused (HTTP 404).");
  });

  it("known OwnerRez client failures map to fixed text", () => {
    expect(
      describeOwnerRezSyncFailure(
        "OwnerRez returned an unexpected response for bookings:recent (page 1): object with keys [items, foo].",
        MARKER,
      ),
    ).toBe("OwnerRez returned data in an unexpected format.");
    expect(
      describeOwnerRezSyncFailure(
        "OwnerRez returned bookings outside the requested properties for bookings:stay-window (batch 1): 2 of 40.",
        MARKER,
      ),
    ).toBe("OwnerRez returned data in an unexpected format.");
    expect(
      describeOwnerRezSyncFailure(
        'OwnerRez pagination for "/bookings" exceeded the maximum of 50 pages — refusing to continue.',
        MARKER,
      ),
    ).toBe("OwnerRez's paging didn't behave as expected.");
    expect(
      describeOwnerRezSyncFailure(
        "OwnerRez reservation sync timed out or the process terminated unexpectedly.",
        MARKER,
      ),
    ).toBe("The sync stopped before finishing (timed out or interrupted).");
    expect(
      describeOwnerRezSyncFailure(
        "OWNERREZ_DEFERRED: OwnerRez rate limit reached (HTTP 429)",
        MARKER,
      ),
    ).toBe("OwnerRez's request limit was reached.");
  });

  it("anything else (database errors, raw exceptions) → generic text, nothing echoed", () => {
    const raw =
      'Invalid `prisma.reservation.create()` invocation: Unique constraint failed on the fields: (`external_reservation_id`) value "16148058" postgresql://user:secret@db';
    const reason = describeOwnerRezSyncFailure(raw, MARKER);
    expect(reason).toBe(
      "An unexpected error stopped the sync (details are in the server logs).",
    );
    for (const leaked of ["prisma", "16148058", "secret", "postgresql"]) {
      expect(reason).not.toContain(leaked);
    }
  });
});
