import { describe, expect, it } from "vitest";

import {
  describeNotionActors,
  describeNotionChange,
  describeNotionLocation,
} from "./notion-activity-describe";
import type { NotionEventDetails } from "./notion-event-enrichment";

const details = (
  overrides: Partial<NotionEventDetails> = {},
): NotionEventDetails => ({
  version: 1,
  action: "updated_properties",
  title: "Router and Thermostat Location",
  breadcrumb: ["Library", "Property Directory", "Palm Haven"],
  visibility: "standard",
  libraryEntryId: "b3bb913f-4b06-44bf-b87c-a692c00f4790",
  actors: [{ type: "person", name: "Michelle" }],
  changedProperties: ["Router location"],
  changedCount: 1,
  inTrash: false,
  ...overrides,
});

describe("describeNotionActors — never invents a name", () => {
  it("uses Notion-supplied names, else an honest generic label", () => {
    expect(describeNotionActors([{ type: "person", name: "Michelle" }])).toBe(
      "Michelle",
    );
    expect(describeNotionActors([{ type: "person", name: null }])).toBe(
      "A Notion user",
    );
    expect(describeNotionActors([{ type: "bot", name: null }])).toBe(
      "An integration",
    );
    expect(describeNotionActors([])).toBe("Someone");
    expect(
      describeNotionActors([
        { type: "person", name: "Kenny" },
        { type: "person", name: null },
      ]),
    ).toBe("Kenny and 1 other");
  });
});

describe("describeNotionLocation / describeNotionChange", () => {
  it("builds a breadcrumb location from titles only", () => {
    expect(describeNotionLocation(details())).toBe(
      "Library › Property Directory › Palm Haven › Router and Thermostat Location",
    );
    expect(describeNotionLocation(details({ title: null }))).toBe(
      "Library › Property Directory › Palm Haven › (untitled page)",
    );
  });

  it("names changed fields (never values) or counts blocks", () => {
    expect(describeNotionChange(details())).toBe("Changed: Router location");
    expect(
      describeNotionChange(details({ changedProperties: [], changedCount: 2 })),
    ).toBe("2 fields changed");
    expect(
      describeNotionChange(
        details({ action: "updated_content", changedCount: 3 }),
      ),
    ).toBe("3 content blocks changed");
    expect(describeNotionChange(details({ action: "moved" }))).toBeNull();
  });
});
