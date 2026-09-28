import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "./page.tsx"),
  "utf8",
);

describe("/reservations OwnerRez wiring (2026-09-28)", () => {
  it("Preview is wired to the read-only preview action and Sync to the real sync action", () => {
    expect(source).toMatch(
      /<PreviewOwnerRezSyncButton action=\{previewOwnerRezSyncAction\}/,
    );
    expect(source).toMatch(
      /<SyncOwnerRezReservationsButton\s+action=\{syncOwnerRezReservationsAction\}/,
    );
  });

  it("neither lives in the page header's actions slot (they sit in the body card)", () => {
    const header = source.slice(
      source.indexOf("<PageHeader"),
      source.indexOf("/>", source.indexOf("</DialogTrigger>")),
    );
    expect(header).not.toMatch(/SyncOwnerRez|PreviewOwnerRez/);
    expect(source).toContain("OwnerRez sync");
  });
});

describe("/reservations OwnerRez sync status (2026-09-30)", () => {
  it("renders the read-only status line inside the OwnerRez sync card, for sync-capable users only", () => {
    expect(source).toMatch(
      /canSyncOwnerRez\s*\?\s*await getOwnerRezSyncStatus\(actor\)/,
    );
    const card = source.slice(source.indexOf("OwnerRez sync</h2>"));
    expect(card.indexOf("<OwnerRezSyncStatusLine")).toBeGreaterThan(-1);
    expect(card.indexOf("<OwnerRezSyncStatusLine")).toBeLessThan(
      card.indexOf("<PreviewOwnerRezSyncButton"),
    );
  });
});

describe("/reservations operational views wiring (2026-09-29)", () => {
  it("renders one server-filtered page of the selected view, not every reservation", () => {
    expect(source).toContain("parseReservationViewParams(await searchParams)");
    expect(source).toMatch(/listReservationView\(actor, params, properties\)/);
    expect(source).not.toMatch(/\blistReservations\(/);
    expect(source).toMatch(/<ReservationList\s+reservations=\{view\.rows\}/);
    expect(source).toContain("<ReservationViewControls");
    expect(source).toContain("<ReservationPagination");
  });

  it("revenue/ADR still come from every reservation (narrow select), as before", () => {
    expect(source).toContain("listReservationRevenueRows(actor)");
    expect(source).toContain("computeRevenueMetrics(reservations)");
  });

  it("offers no 'New bookings' view (createdAt is StayWhile import time)", () => {
    expect(source).not.toMatch(/new booking/i);
    expect(source).not.toMatch(/createdAt/);
  });
});
