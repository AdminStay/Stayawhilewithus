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
