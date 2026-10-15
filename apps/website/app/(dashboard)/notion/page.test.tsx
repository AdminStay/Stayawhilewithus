// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  granted: new Set<string>(),
  listRecentNotionActivity: vi.fn(),
  getNotionIntegrationIdentity: vi.fn(),
  getNotionWebhookSetupStatus: vi.fn(),
  getNotionAccess: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({
  hasPermission: vi.fn(async (_actor: unknown, permission: string) =>
    m.granted.has(permission),
  ),
}));
vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));
vi.mock("@/domains/integrations/actions", () => ({
  clearNotionWebhookTokenAction: vi.fn(),
  fetchNotionPageContentAction: vi.fn(),
  revealNotionWebhookTokenAction: vi.fn(),
  searchNotionAction: vi.fn(),
  searchNotionLibraryAction: vi.fn(),
  updateNotionBlockContentAction: vi.fn(),
  updateNotionFieldAction: vi.fn(),
}));
vi.mock("@/domains/integrations/services/integrations.service", () => ({
  buildNotionListingClientDto: vi.fn((item: unknown) => item),
  getConfirmedNotionPropertyAssociations: vi.fn().mockResolvedValue(new Map()),
  getNotionIntegrationConfigStatus: vi
    .fn()
    .mockResolvedValue({ configured: true }),
  getNotionIntegrationIdentity: m.getNotionIntegrationIdentity,
  getNotionPageContent: vi.fn().mockResolvedValue({ configured: false }),
  listNotionLibraryEntries: vi.fn().mockResolvedValue({ configured: false }),
  listNotionListings: vi.fn().mockResolvedValue({ configured: false }),
}));
vi.mock("@/domains/integrations/services/notion-access.service", () => ({
  getNotionAccess: m.getNotionAccess,
}));
vi.mock("@/domains/integrations/services/notion-activity.service", () => ({
  listRecentNotionActivity: m.listRecentNotionActivity,
}));
vi.mock("@/domains/integrations/services/notion-block-edit.service", () => ({
  listEditableNotionBlockIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/domains/integrations/services/notion-webhook-setup.service", () => ({
  getNotionWebhookSetupStatus: m.getNotionWebhookSetupStatus,
}));
// Heavy client components are stubbed; this test is about page layout and
// gating, not their internals (each has its own tests).
vi.mock("@/domains/integrations/components/NotionSearch", () => ({
  NotionSearch: () => <p>Search stub</p>,
}));
vi.mock("@/domains/integrations/components/NotionSopLibrary", () => ({
  NotionSopLibrary: () => <p>SOPs stub</p>,
}));
vi.mock("@/domains/integrations/components/NotionLibraryBrowser", () => ({
  NotionLibraryBrowser: () => <p>Library stub</p>,
}));
vi.mock("@/domains/integrations/components/NotionListingsSearch", () => ({
  NotionListingsSearch: () => <p>Listings stub</p>,
}));
vi.mock("@/domains/integrations/components/NotionWebhookSetupPanel", () => ({
  NotionWebhookSetupPanel: () => <p>Webhook setup stub</p>,
}));

import NotionPage from "./page";

import { NOTION_DASHBOARD_EDITING_ENABLED } from "@/domains/integrations/config/notion-dashboard-editing";

afterEach(cleanup);

const IDENTITY = {
  configured: true,
  ok: true,
  identity: {
    botName: "StayWhile Dashboard",
    botId: "bot-123",
    workspaceName: "StayWhile",
  },
};

const ACTIVITY_ITEM = {
  id: "row-1",
  action: "updated_properties",
  actionLabel: "Updated",
  who: "Michelle",
  verb: "updated",
  where: "Property Listings › Palm Haven",
  change: "Changed: Bedrooms",
  occurredAt: new Date("2026-10-15T12:00:00.000Z"),
  receivedAt: null,
  restricted: false,
  notionUrl: "https://notion.so/3e26058db989803da1d7f06f8adc27a6",
  earlierValueUnknown: true,
};

function grant(...permissions: string[]) {
  m.granted.clear();
  for (const p of permissions) m.granted.add(p);
  m.getNotionAccess.mockResolvedValue({
    canReadStandard: m.granted.has("notion:read"),
    canReadSensitive: m.granted.has("notion:manage"),
  });
}

async function renderPage() {
  render(await NotionPage());
}

/** True when `a` comes before `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("/notion page layout (2026-10-16)", () => {
  beforeEach(() => {
    m.listRecentNotionActivity.mockReset().mockResolvedValue([ACTIVITY_ITEM]);
    m.getNotionIntegrationIdentity.mockReset().mockResolvedValue(IDENTITY);
    m.getNotionWebhookSetupStatus
      .mockReset()
      .mockResolvedValue({ signingSecretConfigured: true });
  });

  it("puts search and the browsing tabs first, and integration settings last", async () => {
    grant("notion:read", "notion:manage", "integrations:read");
    await renderPage();

    const search = screen.getByText("Search All Notion");
    const tablist = screen.getByRole("tablist", { name: "Notion sections" });
    const settings = screen.getByRole("region", {
      name: "Notion integration settings",
    });
    const diagnostics = screen.getByText("Connection diagnostics");
    const setup = screen.getByText("Activity monitoring setup");

    expect(precedes(search, tablist)).toBe(true);
    expect(precedes(tablist, settings)).toBe(true);
    expect(settings.contains(diagnostics)).toBe(true);
    expect(settings.contains(setup)).toBe(true);
    expect(settings.textContent).toContain("Webhook setup stub");
  });

  it("keeps diagnostics content: integration name, bot id and workspace", async () => {
    grant("notion:read", "integrations:read");
    await renderPage();
    const settings = screen.getByRole("region", {
      name: "Notion integration settings",
    });
    for (const text of ["StayWhile Dashboard", "bot-123", "StayWhile"]) {
      expect(settings.textContent).toContain(text);
    }
  });

  it("shows diagnostics only with integrations:read and webhook setup only with notion:manage", async () => {
    grant("notion:read", "integrations:read");
    await renderPage();
    expect(screen.getByText("Connection diagnostics")).toBeTruthy();
    expect(screen.queryByText("Activity monitoring setup")).toBeNull();
    expect(m.getNotionWebhookSetupStatus).not.toHaveBeenCalled();
    cleanup();
    m.getNotionIntegrationIdentity.mockClear();

    grant("notion:read", "notion:manage");
    await renderPage();
    expect(screen.queryByText("Connection diagnostics")).toBeNull();
    expect(screen.getByText("Activity monitoring setup")).toBeTruthy();
    expect(m.getNotionIntegrationIdentity).not.toHaveBeenCalled();
  });

  it("renders no settings section at all for a viewer with neither permission", async () => {
    grant("notion:read");
    await renderPage();
    expect(
      screen.queryByRole("region", { name: "Notion integration settings" }),
    ).toBeNull();
  });

  it("the activity feed lives in the Recent Activity tab, not at the bottom of the page", async () => {
    grant("notion:read");
    await renderPage();

    // Default tab is SOPs: the feed isn't rendered yet.
    expect(
      screen.getByRole("tab", { name: "SOPs" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByText("Recent Notion Activity")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Recent Activity" }));
    expect(screen.getByText("Recent Notion Activity")).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toContain(
      "Michelle updated Property Listings › Palm Haven",
    );
    const link = screen.getByRole("link", { name: "Open in Notion" });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Earlier value unknown")).toBeTruthy();
  });

  it("shows the empty state inside the tab when no events are recorded", async () => {
    grant("notion:read");
    m.listRecentNotionActivity.mockResolvedValueOnce([]);
    await renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Recent Activity" }));
    expect(
      screen.getByText("No Notion changes have been recorded yet."),
    ).toBeTruthy();
  });

  it("has no Recent Activity tab and never reads activity without notion:read", async () => {
    grant("notion:manage");
    await renderPage();
    expect(screen.queryByRole("tab", { name: "Recent Activity" })).toBeNull();
    expect(m.listRecentNotionActivity).not.toHaveBeenCalled();
  });

  it("stays read-only: dashboard editing is switched off", () => {
    expect(NOTION_DASHBOARD_EDITING_ENABLED).toBe(false);
  });
});
