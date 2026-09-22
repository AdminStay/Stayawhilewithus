import { describe, expect, it, vi } from "vitest";

const {
  mockGetCurrentUser,
  mockGetNotionPageContent,
  mockListEditableNotionBlockIds,
  mockUpdateNotionBlockContent,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetNotionPageContent: vi.fn(),
  mockListEditableNotionBlockIds: vi.fn(),
  mockUpdateNotionBlockContent: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("./services/integrations.service", () => ({
  getNotionPageContent: mockGetNotionPageContent,
}));

vi.mock("./services/notion-edit.service", () => ({
  updateNotionField: vi.fn(),
}));

vi.mock("./services/notion-block-edit.service", () => ({
  listEditableNotionBlockIds: mockListEditableNotionBlockIds,
  updateNotionBlockContent: mockUpdateNotionBlockContent,
}));

vi.mock("@/domains/smart-devices/services/smart-devices.service", () => ({
  syncAugustDevices: vi.fn(),
  syncCieloDevices: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import {
  fetchNotionPageContentAction,
  updateNotionBlockContentAction,
} from "./actions";

const actor = { userId: "user-1" };

describe("fetchNotionPageContentAction", () => {
  it("returns the real page content plus the actor's editable block ids on success", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    const content = { blocks: [], truncated: false };
    mockGetNotionPageContent.mockResolvedValueOnce({
      configured: true,
      ok: true,
      content,
    });
    mockListEditableNotionBlockIds.mockResolvedValueOnce(["b1"]);

    const result = await fetchNotionPageContentAction("page-1");

    expect(mockGetNotionPageContent).toHaveBeenCalledWith(actor, "page-1");
    expect(mockListEditableNotionBlockIds).toHaveBeenCalledWith(
      actor,
      "page-1",
    );
    expect(result).toEqual({
      status: "success",
      content,
      editableBlockIds: ["b1"],
    });
  });

  it("reports not_configured when Notion isn't configured", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockGetNotionPageContent.mockResolvedValueOnce({ configured: false });

    const result = await fetchNotionPageContentAction("page-1");

    expect(result).toEqual({ status: "not_configured" });
  });

  it("passes the service's already-sanitized error message straight through, unchanged", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockGetNotionPageContent.mockResolvedValueOnce({
      configured: true,
      ok: false,
      error: "Couldn't load this page's content from Notion. Please try again.",
    });

    const result = await fetchNotionPageContentAction("page-1");

    expect(result).toEqual({
      status: "error",
      error: "Couldn't load this page's content from Notion. Please try again.",
    });
  });

  it("never returns the underlying error's raw text when getNotionPageContent() itself throws (rather than rejecting with a typed result), even if that error contains sensitive/internal detail", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    const sensitiveError = new Error(
      "Unexpected failure — Authorization: Bearer secret_abc123 at /srv/app/notion/client.ts:42",
    );
    mockGetNotionPageContent.mockRejectedValueOnce(sensitiveError);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await fetchNotionPageContentAction("page-1");

    expect(result).toEqual({
      status: "error",
      error:
        "Something went wrong loading this page's content. Please try again.",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret_abc123");
    expect(serialized).not.toContain("/srv/app");
    consoleErrorSpy.mockRestore();
  });

  it("catches an unexpected thrown error (e.g. RBAC denial) and returns only the fixed generic message, never the raw error text", async () => {
    mockGetCurrentUser.mockRejectedValueOnce(
      new Error(
        "ForbiddenError: user lacks integrations:read at /srv/app/auth.ts:88",
      ),
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await fetchNotionPageContentAction("page-1");

    expect(result).toEqual({
      status: "error",
      error:
        "Something went wrong loading this page's content. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("/srv/app/auth.ts");
    consoleErrorSpy.mockRestore();
  });
});

const BLOCK_INPUT = {
  pageId: "page-1",
  blockId: "b1",
  expectedLastEditedTime: "2026-09-22T00:00:00.000Z",
  text: "Updated text",
};

describe("updateNotionBlockContentAction", () => {
  it("returns the real success result and revalidates /notion", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockUpdateNotionBlockContent.mockResolvedValueOnce({
      status: "success",
      newLastEditedTime: "2026-09-22T01:00:00.000Z",
      newText: "Updated text",
    });

    const result = await updateNotionBlockContentAction(
      { status: "idle" },
      BLOCK_INPUT,
    );

    expect(mockUpdateNotionBlockContent).toHaveBeenCalledWith(
      actor,
      BLOCK_INPUT,
    );
    expect(result).toEqual({
      status: "success",
      newLastEditedTime: "2026-09-22T01:00:00.000Z",
      newText: "Updated text",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/notion");
  });

  it("does not revalidate on a non-success result (e.g. not_editable)", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockUpdateNotionBlockContent.mockResolvedValueOnce({
      status: "not_editable",
    });

    const result = await updateNotionBlockContentAction(
      { status: "idle" },
      BLOCK_INPUT,
    );

    expect(result).toEqual({ status: "not_editable" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("passes through the service's already-sanitized provider_error message unchanged", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockUpdateNotionBlockContent.mockResolvedValueOnce({
      status: "provider_error",
      message: "Couldn't save this change to Notion. Please try again.",
    });

    const result = await updateNotionBlockContentAction(
      { status: "idle" },
      BLOCK_INPUT,
    );

    expect(result).toEqual({
      status: "provider_error",
      message: "Couldn't save this change to Notion. Please try again.",
    });
  });

  it("never returns a raw error string when updateNotionBlockContent() itself throws, even if it contains sensitive/internal detail", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    const sensitiveError = new Error(
      "Unexpected failure — Authorization: Bearer secret_abc123 at /srv/app/notion/client.ts:42",
    );
    mockUpdateNotionBlockContent.mockRejectedValueOnce(sensitiveError);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await updateNotionBlockContentAction(
      { status: "idle" },
      BLOCK_INPUT,
    );

    expect(result).toEqual({
      status: "provider_error",
      message: "Something went wrong saving this change. Please try again.",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret_abc123");
    expect(serialized).not.toContain("/srv/app");
    consoleErrorSpy.mockRestore();
  });

  it("catches an unexpected thrown error (e.g. RBAC denial) and returns only the fixed generic message", async () => {
    mockGetCurrentUser.mockRejectedValueOnce(
      new Error(
        "ForbiddenError: user lacks notion:update at /srv/app/auth.ts:88",
      ),
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await updateNotionBlockContentAction(
      { status: "idle" },
      BLOCK_INPUT,
    );

    expect(result).toEqual({
      status: "provider_error",
      message: "Something went wrong saving this change. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("/srv/app/auth.ts");
    consoleErrorSpy.mockRestore();
  });
});
