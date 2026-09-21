import { describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockGetNotionPageContent } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetNotionPageContent: vi.fn(),
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

vi.mock("@/domains/smart-devices/services/smart-devices.service", () => ({
  syncAugustDevices: vi.fn(),
  syncCieloDevices: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { fetchNotionPageContentAction } from "./actions";

const actor = { userId: "user-1" };

describe("fetchNotionPageContentAction", () => {
  it("returns the real page content on success", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    const content = { blocks: [], truncated: false };
    mockGetNotionPageContent.mockResolvedValueOnce({
      configured: true,
      ok: true,
      content,
    });

    const result = await fetchNotionPageContentAction("page-1");

    expect(mockGetNotionPageContent).toHaveBeenCalledWith(actor, "page-1");
    expect(result).toEqual({ status: "success", content });
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
