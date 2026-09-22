import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertPermission,
  mockHasPermission,
  mockRecordAudit,
  mockGetPageContent,
  mockUpdateBlockContent,
  mockGetBlockContent,
  mockFindBlockEditAllowlistEntry,
} = vi.hoisted(() => ({
  mockAssertPermission: vi.fn(),
  mockHasPermission: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockGetPageContent: vi.fn(),
  mockUpdateBlockContent: vi.fn(),
  mockGetBlockContent: vi.fn(),
  mockFindBlockEditAllowlistEntry: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: mockAssertPermission,
  hasPermission: mockHasPermission,
}));

vi.mock("@stayw/integrations/notion", () => ({
  NotionClient: vi.fn().mockImplementation(() => ({
    getPageContent: mockGetPageContent,
    updateBlockContent: mockUpdateBlockContent,
    getBlockContent: mockGetBlockContent,
  })),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

// Same convention as notion-edit.service.test.ts: findBlockEditAllowlistEntry
// is routed through a mock whose DEFAULT behavior delegates to the real,
// untouched notion-block-edit-allowlist.ts, so the first describe block
// below still exercises the real, genuinely-empty allowlist. Later describe
// blocks override the mock's return value per-test to simulate a block
// having been approved, proving the not-found/conflict/provider-error/
// success branches — otherwise unreachable today — behave correctly. This
// never changes what ships.
vi.mock("../config/notion-block-edit-allowlist", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../config/notion-block-edit-allowlist")
    >();
  mockFindBlockEditAllowlistEntry.mockImplementation(
    actual.findBlockEditAllowlistEntry,
  );
  return {
    ...actual,
    findBlockEditAllowlistEntry: mockFindBlockEditAllowlistEntry,
  };
});

import {
  listEditableNotionBlockIds,
  updateNotionBlockContent,
} from "./notion-block-edit.service";

const ACTOR = { userId: "user-1" };
const BASE_REQUEST = {
  pageId: "page-1",
  blockId: "b1",
  expectedLastEditedTime: "2026-09-22T00:00:00.000Z",
  text: "Updated text",
};

const originalToken = process.env.NOTION_API_KEY;
afterEach(() => {
  process.env.NOTION_API_KEY = originalToken;
});

function textBlock(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "b1",
    lastEditedTime: "2026-09-22T00:00:00.000Z",
    type: "paragraph",
    text: [
      {
        text: "Original text",
        href: null,
        bold: false,
        italic: false,
        code: false,
      },
    ],
    children: [],
    ...overrides,
  };
}

describe("updateNotionBlockContent — real, live allowlist (an unrelated page/block)", () => {
  it("rejects every write attempt with not_editable before any Notion call, for a page/block that isn't the one real approved allowlist entry", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result).toEqual({ status: "not_editable" });
    expect(mockGetPageContent).not.toHaveBeenCalled();
    expect(mockUpdateBlockContent).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("checks notion:update before anything else, and propagates a denial", async () => {
    mockAssertPermission.mockRejectedValueOnce(new Error("ForbiddenError"));

    await expect(
      updateNotionBlockContent(ACTOR, BASE_REQUEST),
    ).rejects.toThrow();
    expect(mockGetPageContent).not.toHaveBeenCalled();
  });

  it("returns a validation_error for malformed input before checking the allowlist", async () => {
    mockAssertPermission.mockResolvedValueOnce(undefined);

    const result = await updateNotionBlockContent(ACTOR, {
      ...BASE_REQUEST,
      pageId: "",
    });

    expect(result.status).toBe("validation_error");
    expect(mockFindBlockEditAllowlistEntry).not.toHaveBeenCalled();
  });
});

describe("updateNotionBlockContent — with a simulated allowlist entry", () => {
  const ALLOWLIST_ENTRY = {
    pageId: "page-1",
    blockId: "b1",
    blockType: "paragraph" as const,
    label: "Test block",
  };

  it("verifies the block actually belongs to the expected page's real content tree before writing — refuses an arbitrary/unrelated blockId as not_editable, never a distinguishing message", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({ blocks: [], truncated: false });

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(mockGetPageContent).toHaveBeenCalledWith("page-1");
    expect(result).toEqual({ status: "not_editable" });
    expect(mockUpdateBlockContent).not.toHaveBeenCalled();
  });

  it("finds the block nested under a toggle's children — proves the search isn't top-level-only", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [
        {
          id: "toggle-1",
          lastEditedTime: "2026-09-22T00:00:00.000Z",
          type: "toggle",
          text: [],
          children: [textBlock()],
        },
      ],
      truncated: false,
    });
    mockUpdateBlockContent.mockResolvedValueOnce({
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Updated text",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });
    mockGetBlockContent.mockResolvedValueOnce({
      type: "paragraph",
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Updated text",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result.status).toBe("success");
  });

  it("refuses as not_editable when the block's real current type no longer matches the allowlisted type", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [textBlock({ type: "heading_1" })],
      truncated: false,
    });

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result).toEqual({ status: "not_editable" });
    expect(mockUpdateBlockContent).not.toHaveBeenCalled();
  });

  it("reports conflict when the block's real lastEditedTime no longer matches what the dashboard loaded", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [textBlock({ lastEditedTime: "2026-09-22T05:00:00.000Z" })],
      truncated: false,
    });

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result).toEqual({ status: "conflict" });
    expect(mockUpdateBlockContent).not.toHaveBeenCalled();
  });

  it("PATCH succeeds + independent verification GET confirms the exact value → success, using the VERIFICATION read's value, never the PATCH echo or the locally-submitted text", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [textBlock()],
      truncated: false,
    });
    // Deliberately different from both the submitted text and the final
    // verified text — proves the PATCH echo is never what's returned.
    mockUpdateBlockContent.mockResolvedValueOnce({
      lastEditedTime: "2026-09-22T00:59:00.000Z",
      text: [
        {
          text: "STALE PATCH ECHO — should never be returned",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });
    mockGetBlockContent.mockResolvedValueOnce({
      type: "paragraph",
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Updated text",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(mockUpdateBlockContent).toHaveBeenCalledWith("b1", "Updated text");
    expect(mockGetBlockContent).toHaveBeenCalledWith("b1");
    expect(result).toEqual({
      status: "success",
      newLastEditedTime: "2026-09-22T01:00:00.000Z",
      newText: "Updated text",
    });
  });

  it("audits success only after the independent verification confirms the value, with the verified text in afterState", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [textBlock()],
      truncated: false,
    });
    mockUpdateBlockContent.mockResolvedValueOnce({
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Updated text",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });
    mockGetBlockContent.mockResolvedValueOnce({
      type: "paragraph",
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Updated text",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });

    await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        action: "notion_block.content_updated",
        entityType: "NotionBlock",
        entityId: "b1",
        beforeState: expect.objectContaining({ text: "Original text" }),
        afterState: expect.objectContaining({ text: "Updated text" }),
      }),
    );
  });

  it("PATCH succeeds + verification GET returns a DIFFERENT value → verification_failed, never success, never audited", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [textBlock()],
      truncated: false,
    });
    mockUpdateBlockContent.mockResolvedValueOnce({
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Updated text",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });
    mockGetBlockContent.mockResolvedValueOnce({
      type: "paragraph",
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Something else entirely",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result).toEqual({
      status: "verification_failed",
      message:
        "The change may not have saved correctly. Please reload and check this content in Notion before trying again.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("PATCH succeeds + verification GET itself fails → verification_failed, never success, never audited, real error preserved server-side for investigation but never returned", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [textBlock()],
      truncated: false,
    });
    mockUpdateBlockContent.mockResolvedValueOnce({
      lastEditedTime: "2026-09-22T01:00:00.000Z",
      text: [
        {
          text: "Updated text",
          href: null,
          bold: false,
          italic: false,
          code: false,
        },
      ],
    });
    const sensitiveError = new Error(
      "Request failed: Authorization: Bearer secret_verify456 at /srv/app/client.ts:3",
    );
    mockGetBlockContent.mockRejectedValueOnce(sensitiveError);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result).toEqual({
      status: "verification_failed",
      message:
        "The change may not have saved correctly. Please reload and check this content in Notion before trying again.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret_verify456");
    expect(serialized).not.toContain("/srv/app");
    // The real error IS preserved server-side (console.error), with enough
    // context (pageId/blockId) to investigate — it's just never returned.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("verification GET failed"),
      expect.objectContaining({
        pageId: "page-1",
        blockId: "b1",
        err: sensitiveError,
      }),
    );
    consoleErrorSpy.mockRestore();
  });

  it("returns a sanitized, fixed provider_error — never the raw error text — when the fresh page-content read fails", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    const sensitiveError = new Error(
      "Request failed: Authorization: Bearer secret_abc123 at /srv/app/client.ts:1",
    );
    mockGetPageContent.mockRejectedValueOnce(sensitiveError);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result).toEqual({
      status: "provider_error",
      message: "Couldn't save this change to Notion. Please try again.",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret_abc123");
    expect(serialized).not.toContain("/srv/app");
    consoleErrorSpy.mockRestore();
  });

  it("returns a sanitized, fixed provider_error — never the raw error text — when the actual PATCH write fails", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockFindBlockEditAllowlistEntry.mockReturnValueOnce(ALLOWLIST_ENTRY);
    mockGetPageContent.mockResolvedValueOnce({
      blocks: [textBlock()],
      truncated: false,
    });
    const sensitiveError = new Error(
      "PATCH failed: Authorization: Bearer secret_xyz789 at /srv/app/client.ts:2",
    );
    mockUpdateBlockContent.mockRejectedValueOnce(sensitiveError);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await updateNotionBlockContent(ACTOR, BASE_REQUEST);

    expect(result).toEqual({
      status: "provider_error",
      message: "Couldn't save this change to Notion. Please try again.",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret_xyz789");
    expect(serialized).not.toContain("/srv/app");
    consoleErrorSpy.mockRestore();
  });
});

describe("listEditableNotionBlockIds", () => {
  // The former controlled-test page — its allowlist entry has been removed
  // now that the real Production write/verify/restore test has already
  // passed (see HANDOFF.md). Kept here only to prove it's no longer
  // editable, not because it's still expected to be.
  const FORMER_TEST_PAGE_ID = "3e26058d-b989-803d-a1d7-f06f8adc27a6";

  it("returns an empty array when the actor lacks notion:update, without reading the allowlist", async () => {
    mockHasPermission.mockResolvedValueOnce(false);

    const result = await listEditableNotionBlockIds(ACTOR, FORMER_TEST_PAGE_ID);

    expect(result).toEqual([]);
  });

  it("returns an empty array for a page with no real allowlist entry, even when the actor has notion:update", async () => {
    mockHasPermission.mockResolvedValueOnce(true);

    const result = await listEditableNotionBlockIds(ACTOR, "page-1");

    expect(result).toEqual([]);
  });

  it("returns an empty array for the former controlled-test page too, now that its allowlist entry is removed — zero pages are write-enabled today", async () => {
    mockHasPermission.mockResolvedValueOnce(true);

    const result = await listEditableNotionBlockIds(ACTOR, FORMER_TEST_PAGE_ID);

    expect(result).toEqual([]);
  });
});
