import { beforeEach, describe, expect, it, vi } from "vitest";

// Uses the REAL config/notion-dashboard-editing.ts (no mock): proves the
// Meeting #5 default — dashboard→Notion editing is off.
vi.mock("server-only", () => ({}));
vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn().mockResolvedValue(true),
}));
const notionCalls = vi.fn();
vi.mock("@stayw/integrations/notion", () => ({
  NotionClient: vi
    .fn()
    .mockImplementation(() => new Proxy({}, { get: () => notionCalls })),
}));
vi.mock("@stayw/database", () => ({ prisma: {} }));
vi.mock("@/platform/audit/record-audit", () => ({ recordAudit: vi.fn() }));

import { assertPermission, hasPermission } from "@stayw/auth";

import {
  isNotionDashboardEditingEnabled,
  NOTION_DASHBOARD_EDITING_ENABLED,
} from "../config/notion-dashboard-editing";

import {
  listEditableNotionBlockIds,
  updateNotionBlockContent,
} from "./notion-block-edit.service";
import { updateNotionField } from "./notion-edit.service";

const admin = { userId: "admin-1" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTION_API_KEY = "test-key";
});

describe("Meeting #5 — Notion dashboard editing is OFF (real config)", () => {
  it("the switch is false", () => {
    expect(NOTION_DASHBOARD_EDITING_ENABLED).toBe(false);
    expect(isNotionDashboardEditingEnabled()).toBe(false);
  });

  it("field writes are refused before any permission check or Notion call — even for an admin", async () => {
    await expect(
      updateNotionField(admin as never, {
        dataSourceId: "ds",
        pageId: "p",
        field: "name",
        value: "x",
        expectedLastEditedTime: "2026-09-30T00:00:00.000Z",
      }),
    ).resolves.toEqual({ status: "not_editable" });
    expect(assertPermission).not.toHaveBeenCalled();
    expect(notionCalls).not.toHaveBeenCalled();
  });

  it("block writes are refused before any permission check or Notion call", async () => {
    await expect(
      updateNotionBlockContent(admin as never, {
        pageId: "p",
        blockId: "b",
        text: "x",
        expectedLastEditedTime: "2026-09-30T00:00:00.000Z",
      }),
    ).resolves.toEqual({ status: "not_editable" });
    expect(assertPermission).not.toHaveBeenCalled();
    expect(notionCalls).not.toHaveBeenCalled();
  });

  it("no block is ever reported editable, even to a user holding notion:update", async () => {
    await expect(
      listEditableNotionBlockIds(admin as never, "any-page"),
    ).resolves.toEqual([]);
    expect(hasPermission).not.toHaveBeenCalled();
  });
});
