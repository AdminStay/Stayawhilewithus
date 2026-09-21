// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockHasPermission, mockListResourceLinks, mockListProperties } =
  vi.hoisted(() => ({
    mockHasPermission: vi.fn(),
    mockListResourceLinks: vi.fn(),
    mockListProperties: vi.fn(),
  }));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@stayw/auth", () => ({
  hasPermission: mockHasPermission,
}));

vi.mock("@/domains/resources/services/resource-links.service", () => ({
  listResourceLinks: mockListResourceLinks,
}));

vi.mock("@/domains/properties/services/properties.service", () => ({
  listProperties: mockListProperties,
}));

import ResourcesPage from "./page";

afterEach(cleanup);

beforeEach(() => {
  mockListResourceLinks.mockReset().mockResolvedValue([]);
  mockListProperties.mockReset().mockResolvedValue([]);
  mockHasPermission.mockReset();
});

describe("ResourcesPage — write-capability authorization", () => {
  it("shows 'Add resource' when the actor holds resource_links:create (admin)", async () => {
    mockHasPermission.mockImplementation(
      async (_actor, key) => key === "resource_links:create",
    );

    const jsx = await ResourcesPage();
    render(jsx);

    expect(mockHasPermission).toHaveBeenCalledWith(
      { userId: "user-1" },
      "resource_links:create",
    );
    expect(screen.getByRole("button", { name: /add resource/i })).toBeTruthy();
  });

  it("hides 'Add resource' entirely for a read-only actor — never shows a control that would just fail on click", async () => {
    mockHasPermission.mockResolvedValue(false);

    const jsx = await ResourcesPage();
    render(jsx);

    expect(screen.queryByRole("button", { name: /add resource/i })).toBeNull();
  });

  it("passes canManage=true through to the list only when resource_links:update is granted", async () => {
    mockHasPermission.mockImplementation(
      async (_actor, key) => key === "resource_links:update",
    );
    mockListResourceLinks.mockResolvedValue([
      {
        id: "r1",
        name: "Pool vendor",
        url: "https://example.com/pool",
        description: null,
        category: "VENDOR",
        propertyId: null,
        property: null,
      },
    ]);

    const jsx = await ResourcesPage();
    render(jsx);

    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("shows no Edit/Delete controls for a read-only actor even with resources present", async () => {
    mockHasPermission.mockResolvedValue(false);
    mockListResourceLinks.mockResolvedValue([
      {
        id: "r1",
        name: "Pool vendor",
        url: "https://example.com/pool",
        description: null,
        category: "VENDOR",
        propertyId: null,
        property: null,
      },
    ]);

    const jsx = await ResourcesPage();
    render(jsx);

    expect(screen.getByText("Pool vendor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
