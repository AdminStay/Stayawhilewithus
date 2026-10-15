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
  it("uses the name Notion supplied for a person", () => {
    expect(describeNotionActors([{ type: "person", name: "Michelle" }])).toBe(
      "Michelle",
    );
    // Whatever account Notion reports, e.g. a shared login, is shown as is.
    expect(
      describeNotionActors([{ type: "person", name: "Info StayAile" }]),
    ).toBe("Info StayAile");
  });

  it("says Unknown editor when Notion gave no editor or no name", () => {
    expect(describeNotionActors([])).toBe("Unknown editor");
    expect(describeNotionActors([{ type: "person", name: null }])).toBe(
      "Unknown editor",
    );
    expect(
      describeNotionActors([
        { type: "person", name: null },
        { type: "person", name: null },
      ]),
    ).toBe("2 unknown editors");
  });

  it("keeps integration and agent labels, with Notion's name when supplied", () => {
    expect(describeNotionActors([{ type: "bot", name: null }])).toBe(
      "An integration",
    );
    expect(describeNotionActors([{ type: "bot", name: "Zapier" }])).toBe(
      "Zapier (integration)",
    );
    expect(describeNotionActors([{ type: "agent", name: null }])).toBe(
      "A Notion agent",
    );
    expect(describeNotionActors([{ type: "agent", name: "Helper" }])).toBe(
      "Helper (Notion agent)",
    );
  });

  it("represents every author: names first, then unknown people, integrations and agents", () => {
    expect(
      describeNotionActors([
        { type: "person", name: "Kenny" },
        { type: "person", name: "Michelle" },
      ]),
    ).toBe("Kenny and Michelle");
    expect(
      describeNotionActors([
        { type: "person", name: "Kenny" },
        { type: "person", name: null },
      ]),
    ).toBe("Kenny and an unknown editor");
    expect(
      describeNotionActors([
        { type: "person", name: null },
        { type: "bot", name: null },
        { type: "person", name: "Kenny" },
        { type: "agent", name: null },
      ]),
    ).toBe("Kenny, an unknown editor, an integration and a Notion agent");
    expect(
      describeNotionActors([
        { type: "bot", name: null },
        { type: "bot", name: null },
      ]),
    ).toBe("2 integrations");
  });

  it("counts authors Notion reported beyond those stored", () => {
    expect(
      describeNotionActors([{ type: "person", name: "Michelle" }], 1),
    ).toBe("Michelle and 1 other");
    expect(describeNotionActors([{ type: "person", name: null }], 3)).toBe(
      "Unknown editor and 3 others",
    );
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
