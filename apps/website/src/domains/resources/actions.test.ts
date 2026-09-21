import { describe, expect, it, vi } from "vitest";

const {
  mockGetCurrentUser,
  mockCreateResourceLink,
  mockUpdateResourceLink,
  mockDeleteResourceLink,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockCreateResourceLink: vi.fn(),
  mockUpdateResourceLink: vi.fn(),
  mockDeleteResourceLink: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("./services/resource-links.service", () => ({
  createResourceLink: mockCreateResourceLink,
  updateResourceLink: mockUpdateResourceLink,
  deleteResourceLink: mockDeleteResourceLink,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import {
  createResourceLinkAction,
  deleteResourceLinkAction,
  updateResourceLinkAction,
  type ResourceLinkFormState,
} from "./actions";

const actor = { userId: "user-1" };
const IDLE: ResourceLinkFormState = { status: "idle" };
const VALID_ID = "11111111-1111-1111-1111-111111111111";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("createResourceLinkAction", () => {
  it("valid create: calls the service, revalidates /resources, and returns success", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockCreateResourceLink.mockResolvedValueOnce({ id: "r1" });

    const result = await createResourceLinkAction(
      IDLE,
      formData({
        name: "Pool vendor",
        url: "https://example.com/pool",
        description: "",
        category: "VENDOR",
        propertyId: "",
      }),
    );

    expect(result).toEqual({ status: "success" });
    expect(mockCreateResourceLink).toHaveBeenCalledWith(actor, {
      name: "Pool vendor",
      url: "https://example.com/pool",
      description: "",
      category: "VENDOR",
      propertyId: "",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resources");
  });

  it("rejects a javascript: URL with a user-visible validation error — never calls the service, never throws to a generic error boundary", async () => {
    const result = await createResourceLinkAction(
      IDLE,
      formData({
        name: "Malicious",
        url: "javascript:alert(1)",
        description: "",
        category: "OTHER",
        propertyId: "",
      }),
    );

    expect(result.status).toBe("validation_error");
    expect((result as { message: string }).message).toMatch(/http/i);
    expect(mockCreateResourceLink).not.toHaveBeenCalled();
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a data: URL the same way", async () => {
    const result = await createResourceLinkAction(
      IDLE,
      formData({
        name: "Malicious",
        url: "data:text/html,<script>alert(1)</script>",
        description: "",
        category: "OTHER",
        propertyId: "",
      }),
    );

    expect(result.status).toBe("validation_error");
    expect(mockCreateResourceLink).not.toHaveBeenCalled();
  });

  it("rejects a blank name with a validation error — never calls the service", async () => {
    const result = await createResourceLinkAction(
      IDLE,
      formData({
        name: "",
        url: "https://example.com",
        description: "",
        category: "OTHER",
        propertyId: "",
      }),
    );

    expect(result.status).toBe("validation_error");
    expect(mockCreateResourceLink).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected service failure — never leaks the real error message", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockCreateResourceLink.mockRejectedValueOnce(
      new Error(
        "connection to server at 127.0.0.1, port 5432 failed: FATAL secret_key=abc123",
      ),
    );

    const result = await createResourceLinkAction(
      IDLE,
      formData({
        name: "Pool vendor",
        url: "https://example.com/pool",
        description: "",
        category: "VENDOR",
        propertyId: "",
      }),
    );

    expect(result).toEqual({
      status: "error",
      message: "Something went wrong saving this resource. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("5432");
    expect(JSON.stringify(result)).not.toContain("secret_key");
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateResourceLinkAction", () => {
  it("valid edit: calls the service, revalidates /resources, and returns success", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockUpdateResourceLink.mockResolvedValueOnce({ id: "r1" });

    const result = await updateResourceLinkAction(
      IDLE,
      formData({
        id: VALID_ID,
        name: "Pool vendor",
        url: "https://example.com/pool",
        description: "",
        category: "VENDOR",
        propertyId: "",
      }),
    );

    expect(result).toEqual({ status: "success" });
    expect(mockUpdateResourceLink).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ name: "Pool vendor" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resources");
  });

  it("rejects a data: URL with a user-visible validation error — never calls the service", async () => {
    const result = await updateResourceLinkAction(
      IDLE,
      formData({
        id: VALID_ID,
        name: "Malicious",
        url: "data:text/html,<script>alert(1)</script>",
        description: "",
        category: "OTHER",
        propertyId: "",
      }),
    );

    expect(result.status).toBe("validation_error");
    expect(mockUpdateResourceLink).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected service failure — never leaks the real error message", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockUpdateResourceLink.mockRejectedValueOnce(
      new Error("Prisma error P2025: record not found in table resource_links"),
    );

    const result = await updateResourceLinkAction(
      IDLE,
      formData({
        id: VALID_ID,
        name: "Pool vendor",
        url: "https://example.com/pool",
        description: "",
        category: "VENDOR",
        propertyId: "",
      }),
    );

    expect(result).toEqual({
      status: "error",
      message: "Something went wrong saving this resource. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("Prisma");
    expect(JSON.stringify(result)).not.toContain("P2025");
  });
});

describe("deleteResourceLinkAction — unchanged, reviewed, no defect found", () => {
  it("calls deleteResourceLink with the submitted id and revalidates /resources", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);
    mockDeleteResourceLink.mockResolvedValueOnce({ id: "r1" });

    await deleteResourceLinkAction(formData({ id: VALID_ID }));

    expect(mockDeleteResourceLink).toHaveBeenCalledWith(actor, VALID_ID);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resources");
  });

  it("rejects a non-UUID id before ever calling the service", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(actor);

    await expect(
      deleteResourceLinkAction(formData({ id: "not-a-uuid" })),
    ).rejects.toThrow();

    expect(mockDeleteResourceLink).not.toHaveBeenCalled();
  });
});
