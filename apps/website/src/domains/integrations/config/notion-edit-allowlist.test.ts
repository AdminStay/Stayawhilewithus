import { describe, expect, it } from "vitest";

import {
  annotateNotionFieldEditability,
  findEditAllowlistEntry,
  NOTION_EDIT_ALLOWLIST,
  type NotionEditAllowlistEntry,
} from "./notion-edit-allowlist";

const FIELDS = [
  { field: "guidebookUrl" as const, label: "Guidebook", value: "https://x" },
  { field: "name" as const, label: "Property", value: "Camingo" },
];

const FAKE_ALLOWLIST: readonly NotionEditAllowlistEntry[] = [
  {
    dataSourceId: "ds-1",
    field: "guidebookUrl",
    fieldType: "url",
    label: "Guidebook",
  },
];

describe("NOTION_EDIT_ALLOWLIST — real, live config", () => {
  it("is empty — no field is editable in the real app until Kenny/Michelle approve one", () => {
    expect(NOTION_EDIT_ALLOWLIST).toEqual([]);
  });

  it("findEditAllowlistEntry returns null for every field against the real, empty allowlist", () => {
    for (const f of FIELDS) {
      expect(findEditAllowlistEntry("ds-1", f.field)).toBeNull();
    }
  });
});

describe("annotateNotionFieldEditability", () => {
  it("marks every field non-editable against the real, live (empty) allowlist, even when canEdit is true — proves today's dashboard stays 100% read-only", () => {
    const result = annotateNotionFieldEditability(FIELDS, "ds-1", true);

    expect(result.every((f) => f.editable === false)).toBe(true);
    expect(result.every((f) => f.edit === undefined)).toBe(true);
  });

  it("marks every field non-editable when the actor lacks notion:update, even against a fake allowlist that WOULD otherwise allow it", () => {
    const result = annotateNotionFieldEditability(
      FIELDS,
      "ds-1",
      false,
      FAKE_ALLOWLIST,
    );

    expect(result.every((f) => f.editable === false)).toBe(true);
  });

  it("marks a field editable only when it's both permitted AND allowlisted (simulated allowlist, real one untouched)", () => {
    const result = annotateNotionFieldEditability(
      FIELDS,
      "ds-1",
      true,
      FAKE_ALLOWLIST,
    );

    const guidebook = result.find((f) => f.field === "guidebookUrl");
    const name = result.find((f) => f.field === "name");
    expect(guidebook).toEqual(
      expect.objectContaining({
        editable: true,
        edit: { fieldType: "url", options: undefined },
      }),
    );
    expect(name).toEqual(expect.objectContaining({ editable: false }));
  });

  it("does not mark a field editable for a different dataSourceId than the allowlist entry names", () => {
    const result = annotateNotionFieldEditability(
      FIELDS,
      "a-different-data-source",
      true,
      FAKE_ALLOWLIST,
    );

    expect(result.every((f) => f.editable === false)).toBe(true);
  });

  it("passes through select/multi_select options for the edit control to use", () => {
    const allowlistWithOptions: readonly NotionEditAllowlistEntry[] = [
      {
        dataSourceId: "ds-1",
        field: "guidebookUrl",
        fieldType: "select",
        label: "Status",
        options: ["Active", "Inactive"],
      },
    ];

    const [result] = annotateNotionFieldEditability(
      [FIELDS[0]!],
      "ds-1",
      true,
      allowlistWithOptions,
    );

    expect(result?.edit).toEqual({
      fieldType: "select",
      options: ["Active", "Inactive"],
    });
  });

  it("never mutates the input fields array", () => {
    const original = [...FIELDS];

    annotateNotionFieldEditability(FIELDS, "ds-1", true, FAKE_ALLOWLIST);

    expect(FIELDS).toEqual(original);
  });
});
