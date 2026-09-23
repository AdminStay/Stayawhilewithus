// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ResourceLinkList and EditResourceLinkForm (which it renders inside its
// Edit dialog) both import their server actions directly from "../actions"
// — a "use server" file that transitively pulls in resource-links.service's
// "server-only" guard. Real Next.js specially rewrites a "use server" file
// for a client import; a plain Vitest/Vite transform does not, so it would
// otherwise try to actually load that server-only module here. Mocking the
// two actions this component tree ever uses sidesteps that without
// changing any component source — same fix class as NotionFieldEditor's,
// applied at the test boundary here since this component has no
// useActionState of its own to thread the action through as a prop.
vi.mock("../actions", () => ({
  deleteResourceLinkAction: vi.fn(),
  updateResourceLinkAction: vi.fn(),
}));

import { deleteResourceLinkAction } from "../actions";

import { ResourceLinkList } from "./ResourceLinkList";

afterEach(cleanup);

const RESOURCE = {
  id: "r1",
  name: "Pool vendor",
  url: "https://example.com/pool-service",
  description: "Call for pool maintenance",
  category: "VENDOR" as const,
  propertyId: null,
  property: null,
  createdByUserId: "user-1",
  deletedAt: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const PROPERTIES = [{ id: "p1", name: "Camingo" }];

describe("ResourceLinkList", () => {
  it("shows the empty state when there are no resources", () => {
    render(
      <ResourceLinkList
        resourceLinks={[]}
        properties={[]}
        canManage
        updateAction={vi.fn()}
      />,
    );

    expect(screen.getByText("No resources yet")).toBeTruthy();
  });

  it("renders an existing resource's name and a safe external link (target=_blank, rel=noopener noreferrer)", () => {
    render(
      <ResourceLinkList
        resourceLinks={[RESOURCE]}
        properties={PROPERTIES}
        canManage={false}
        updateAction={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: /Pool vendor/i });
    expect(link.getAttribute("href")).toBe("https://example.com/pool-service");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows Edit and Delete controls when canManage is true", () => {
    render(
      <ResourceLinkList
        resourceLinks={[RESOURCE]}
        properties={PROPERTIES}
        canManage
        updateAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("hides Edit and Delete controls (and the Actions column) when canManage is false", () => {
    render(
      <ResourceLinkList
        resourceLinks={[RESOURCE]}
        properties={PROPERTIES}
        canManage={false}
        updateAction={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
  });

  it("still shows the resource's name/link/category for a read-only viewer — view access is unaffected by canManage", () => {
    render(
      <ResourceLinkList
        resourceLinks={[RESOURCE]}
        properties={PROPERTIES}
        canManage={false}
        updateAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Pool vendor")).toBeTruthy();
    expect(screen.getByText("Vendor / Service Provider")).toBeTruthy();
  });

  describe("Delete confirmation (V1 safety improvement — soft delete, no Restore UI yet)", () => {
    it("REQUIRES CONFIRMATION: gates Delete behind window.confirm(), naming the exact resource and stating there is no Restore option yet", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <ResourceLinkList
          resourceLinks={[RESOURCE]}
          properties={PROPERTIES}
          canManage
          updateAction={vi.fn()}
        />,
      );

      screen.getByRole("button", { name: "Delete" }).click();

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      const message = confirmSpy.mock.calls[0]?.[0] as string;
      expect(message).toMatch(/Pool vendor/);
      expect(message).toMatch(/Resources list/i);
      expect(message).toMatch(/no Restore option/i);
      confirmSpy.mockRestore();
    });

    it("CANCEL: when the confirmation is dismissed, the delete action is never called — zero changes", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <ResourceLinkList
          resourceLinks={[RESOURCE]}
          properties={PROPERTIES}
          canManage
          updateAction={vi.fn()}
        />,
      );

      screen.getByRole("button", { name: "Delete" }).click();

      expect(deleteResourceLinkAction).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("CONFIRM: when the confirmation is accepted, the click is allowed through — the existing delete action's form still targets exactly this resource's id, no fuzzy/derived targeting", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(
        <ResourceLinkList
          resourceLinks={[RESOURCE]}
          properties={PROPERTIES}
          canManage
          updateAction={vi.fn()}
        />,
      );

      const deleteButton = screen.getByRole("button", { name: "Delete" });
      const form = deleteButton.closest("form")!;
      const hiddenInput = form.querySelector(
        'input[name="id"]',
      ) as HTMLInputElement;
      expect(hiddenInput.value).toBe("r1");

      deleteButton.click();

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      confirmSpy.mockRestore();
    });

    it("Ops Manager (canManage=false) still has no Delete control at all — confirmation is moot when the control isn't rendered", () => {
      render(
        <ResourceLinkList
          resourceLinks={[RESOURCE]}
          properties={PROPERTIES}
          canManage={false}
          updateAction={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    });
  });
});
