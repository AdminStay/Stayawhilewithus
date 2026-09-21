import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertPermission,
  mockRecordAudit,
  mockListDataSourceRecords,
  mockUpdatePageProperty,
  mockFindEditAllowlistEntry,
} = vi.hoisted(() => ({
  mockAssertPermission: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockListDataSourceRecords: vi.fn(),
  mockUpdatePageProperty: vi.fn(),
  mockFindEditAllowlistEntry: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: mockAssertPermission,
}));

vi.mock("@stayw/integrations/notion", () => ({
  NotionClient: vi.fn().mockImplementation(() => ({
    listDataSourceRecords: mockListDataSourceRecords,
    updatePageProperty: mockUpdatePageProperty,
  })),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

// findEditAllowlistEntry is routed through a mock whose DEFAULT behavior
// delegates to the real, untouched notion-edit-allowlist.ts (so the first
// describe block below still exercises the real, genuinely-empty allowlist).
// The second describe block overrides the mock's return value per-test to
// simulate a field having been approved, proving the conflict/validation/
// provider-error/success branches — otherwise unreachable today — behave
// correctly. This never changes what ships: the allowlist file itself, and
// every test in the first describe block, are unaffected.
vi.mock("../config/notion-edit-allowlist", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../config/notion-edit-allowlist")>();
  mockFindEditAllowlistEntry.mockImplementation(actual.findEditAllowlistEntry);
  return {
    ...actual,
    findEditAllowlistEntry: mockFindEditAllowlistEntry,
  };
});

import { updateNotionField } from "./notion-edit.service";

const ACTOR = { userId: "user-1" };
const BASE_REQUEST = {
  pageId: "page-1",
  dataSourceId: "ds-1",
  field: "guidebookUrl",
  expectedLastEditedTime: "2026-09-01T00:00:00.000Z",
  value: "https://guidebook.example/x",
};

describe("updateNotionField — fail-closed while NOTION_EDIT_ALLOWLIST is empty", () => {
  it("rejects every field with not_editable — the allowlist is empty, so no field can ever be edited today", async () => {
    process.env.NOTION_API_KEY = "test-token";
    const result = await updateNotionField(ACTOR, BASE_REQUEST);
    expect(result).toEqual({ status: "not_editable" });
  });

  it("never calls listDataSourceRecords (the stale-data check) when the field isn't even allowlisted — the allowlist check happens first", async () => {
    process.env.NOTION_API_KEY = "test-token";
    await updateNotionField(ACTOR, BASE_REQUEST);
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
  });

  it("never calls recordAudit when the write is rejected — no audit-log noise for a request that never touched Notion", async () => {
    process.env.NOTION_API_KEY = "test-token";
    await updateNotionField(ACTOR, BASE_REQUEST);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("enforces notion:update RBAC before anything else, regardless of allowlist state", async () => {
    process.env.NOTION_API_KEY = "test-token";
    mockAssertPermission.mockRejectedValueOnce(new Error("ForbiddenError"));

    await expect(updateNotionField(ACTOR, BASE_REQUEST)).rejects.toThrow(
      "ForbiddenError",
    );
    expect(mockAssertPermission).toHaveBeenCalledWith(ACTOR, "notion:update");
  });

  it("validates the request shape before checking the allowlist — a malformed request throws, never silently proceeds", async () => {
    process.env.NOTION_API_KEY = "test-token";
    mockAssertPermission.mockResolvedValueOnce(undefined);

    await expect(
      updateNotionField(ACTOR, { ...BASE_REQUEST, pageId: "" }),
    ).rejects.toThrow();
  });

  it("rejects every one of a representative sample of field names — proving this isn't a partial allowlist gap for one specific field", async () => {
    process.env.NOTION_API_KEY = "test-token";
    for (const field of ["name", "address", "airbnbLink", "notARealField"]) {
      const result = await updateNotionField(ACTOR, {
        ...BASE_REQUEST,
        field,
      });
      expect(result).toEqual({ status: "not_editable" });
    }
  });
});

describe("SOURCE-LEVEL GUARANTEE: no delete/archive path exists in this service", () => {
  it("never references an archive/delete/trash operation anywhere in its own source", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(__dirname, "./notion-edit.service.ts"),
      "utf8",
    );
    for (const forbidden of ["archive", "delete", "trash", "in_trash"]) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });
});

/**
 * Everything below simulates a field being approved and added to
 * NOTION_EDIT_ALLOWLIST — via mockFindEditAllowlistEntry, never by touching
 * the real (still-empty) allowlist file — to prove the conflict/validation/
 * provider-error/success branches of updateNotionField are actually correct
 * NOW, before Kenny/Michelle approve a real field. These branches are
 * unreachable in production today and had zero coverage before this file.
 */
describe("updateNotionField — conflict/validation/provider-error/success (simulated allowlist entry)", () => {
  const ALLOWLIST_ENTRY = {
    dataSourceId: "ds-1",
    field: "guidebookUrl" as const,
    fieldType: "url" as const,
    label: "Guidebook",
  };

  beforeEach(() => {
    process.env.NOTION_API_KEY = "test-token";
    mockAssertPermission.mockReset().mockResolvedValue(undefined);
    mockFindEditAllowlistEntry.mockReset().mockReturnValue(ALLOWLIST_ENTRY);
    mockListDataSourceRecords.mockReset();
    mockUpdatePageProperty.mockReset();
    mockRecordAudit.mockReset();
  });

  it("returns conflict when the live Notion lastEditedTime no longer matches what the dashboard loaded", async () => {
    mockListDataSourceRecords.mockResolvedValueOnce([
      {
        id: "page-1",
        guidebookUrl: "https://old.example/guide",
        lastEditedTime: "2026-09-05T00:00:00.000Z", // differs from BASE_REQUEST's expectedLastEditedTime
      },
    ]);

    const result = await updateNotionField(ACTOR, BASE_REQUEST);

    expect(result).toEqual({ status: "conflict" });
    expect(mockUpdatePageProperty).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("returns provider_error when the page id from the request is no longer present in Notion's current rows", async () => {
    mockListDataSourceRecords.mockResolvedValueOnce([]);

    const result = await updateNotionField(ACTOR, BASE_REQUEST);

    expect(result).toEqual({
      status: "provider_error",
      message: "Page no longer found.",
    });
  });

  it("returns provider_error when the stale-data read itself fails (Notion API error), never throws uncaught", async () => {
    mockListDataSourceRecords.mockRejectedValueOnce(new Error("Notion 503"));

    const result = await updateNotionField(ACTOR, BASE_REQUEST);

    expect(result).toEqual({ status: "provider_error", message: "Notion 503" });
  });

  it("returns validation_error when the submitted value fails the field's own type schema — checked before the stale-data read or any write", async () => {
    const result = await updateNotionField(ACTOR, {
      ...BASE_REQUEST,
      value: "not a url",
    });

    expect(result.status).toBe("validation_error");
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
    expect(mockUpdatePageProperty).not.toHaveBeenCalled();
  });

  it("returns provider_error (not an uncaught crash) when the real write call is reached — proving the client.ts NotImplementedError stub is safely handled even if the allowlist were ever populated", async () => {
    mockListDataSourceRecords.mockResolvedValueOnce([
      {
        id: "page-1",
        guidebookUrl: "https://old.example/guide",
        lastEditedTime: BASE_REQUEST.expectedLastEditedTime,
      },
    ]);
    mockUpdatePageProperty.mockRejectedValueOnce(
      new Error("Notion: updatePageProperty is not implemented"),
    );

    const result = await updateNotionField(ACTOR, BASE_REQUEST);

    expect(result).toEqual({
      status: "provider_error",
      message: "Notion: updatePageProperty is not implemented",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("on success: writes via updatePageProperty, records an audit entry with before/after state, and never logs a delete/archive action", async () => {
    mockListDataSourceRecords.mockResolvedValueOnce([
      {
        id: "page-1",
        guidebookUrl: "https://old.example/guide",
        lastEditedTime: BASE_REQUEST.expectedLastEditedTime,
      },
    ]);
    mockUpdatePageProperty.mockResolvedValueOnce({
      lastEditedTime: "2026-09-22T00:00:00.000Z",
    });

    const result = await updateNotionField(ACTOR, BASE_REQUEST);

    expect(result).toEqual({
      status: "success",
      newLastEditedTime: "2026-09-22T00:00:00.000Z",
      newValue: "https://guidebook.example/x",
    });
    expect(mockUpdatePageProperty).toHaveBeenCalledWith(
      "page-1",
      "guidebookUrl",
      "https://guidebook.example/x",
    );
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    const auditCall = mockRecordAudit.mock.calls[0]?.[0] as
      { action: string; beforeState: unknown; afterState: unknown } | undefined;
    expect(auditCall?.action).toBe("notion_page.field_updated");
    expect(auditCall?.beforeState).toEqual({
      field: "guidebookUrl",
      value: "https://old.example/guide",
    });
    expect(auditCall?.afterState).toEqual({
      field: "guidebookUrl",
      value: "https://guidebook.example/x",
    });
  });
});
