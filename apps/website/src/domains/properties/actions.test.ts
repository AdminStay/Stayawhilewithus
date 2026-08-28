import { describe, expect, it, vi } from "vitest";

const {
  mockRevalidatePath,
  mockCreatePropertyFromOwnerRez,
  mockConfirmOwnerRezLink,
  mockCreateProperty,
  mockDeleteProperty,
  mockUpdatePropertyOccupancy,
  mockUpdatePropertyStatus,
} = vi.hoisted(() => ({
  mockRevalidatePath: vi.fn(),
  mockCreatePropertyFromOwnerRez: vi.fn(),
  mockConfirmOwnerRezLink: vi.fn(),
  mockCreateProperty: vi.fn(),
  mockDeleteProperty: vi.fn(),
  mockUpdatePropertyOccupancy: vi.fn(),
  mockUpdatePropertyStatus: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("./services/ownerrez-link.service", () => ({
  confirmOwnerRezLink: mockConfirmOwnerRezLink,
}));

vi.mock("./services/ownerrez-onboarding.service", () => ({
  createPropertyFromOwnerRez: mockCreatePropertyFromOwnerRez,
}));

vi.mock("./services/properties.service", () => ({
  createProperty: mockCreateProperty,
  deleteProperty: mockDeleteProperty,
  updatePropertyOccupancy: mockUpdatePropertyOccupancy,
  updatePropertyStatus: mockUpdatePropertyStatus,
}));

import { createPropertyFromOwnerRezAction } from "./actions";

const IDLE = { status: "idle" as const };

function formDataWith(ownerRezPropertyId: string): FormData {
  const fd = new FormData();
  fd.set("ownerRezPropertyId", ownerRezPropertyId);
  return fd;
}

const GENERIC_ERROR =
  "Something went wrong creating this property. Try again, or check with an admin if this keeps happening.";

describe("createPropertyFromOwnerRezAction", () => {
  it("returns a success state with the created property's id/name and revalidates the page", async () => {
    mockCreatePropertyFromOwnerRez.mockResolvedValueOnce({
      id: "prop-123",
      name: "Camingo",
    });

    const result = await createPropertyFromOwnerRezAction(
      IDLE,
      formDataWith("480307"),
    );

    expect(result).toEqual({
      status: "success",
      propertyId: "prop-123",
      propertyName: "Camingo",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/properties/ownerrez");
  });

  it("surfaces a deliberate business-logic error message verbatim instead of throwing", async () => {
    mockCreatePropertyFromOwnerRez.mockRejectedValueOnce(
      new Error(
        "Cannot create a StayWhile property from OwnerRez property 480307 — missing required field(s): time_zone. This property needs manual review instead.",
      ),
    );

    const result = await createPropertyFromOwnerRezAction(
      IDLE,
      formDataWith("480307"),
    );

    expect(result).toEqual({
      status: "failure",
      error:
        "Cannot create a StayWhile property from OwnerRez property 480307 — missing required field(s): time_zone. This property needs manual review instead.",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces the duplicate-link business-logic error message verbatim", async () => {
    mockCreatePropertyFromOwnerRez.mockRejectedValueOnce(
      new Error(
        "This OwnerRez property is already linked to a StayWhile property.",
      ),
    );

    const result = await createPropertyFromOwnerRezAction(
      IDLE,
      formDataWith("480307"),
    );

    expect(result).toEqual({
      status: "failure",
      error:
        "This OwnerRez property is already linked to a StayWhile property.",
    });
  });

  // Named exactly like Prisma's own error classes — isPrismaClientError()
  // is duck-typed on the constructor name (same convention as this domain's
  // existing isUniqueConstraintViolation()), so a real
  // Prisma.PrismaClientValidationError instance would be classified
  // identically to these, without needing to construct one for real here.
  class PrismaClientValidationError extends Error {}
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }

  it("replaces a raw PrismaClientValidationError with the generic safe message — never leaks the real (verbose, technical) validation dump", async () => {
    const rawValidationError = new PrismaClientValidationError(
      'Invalid `prisma.property.create()` invocation:\n\n{\n  data: {\n    bedroomCount: "3", // <- real technical dump, must never reach the UI\n  }\n}',
    );
    mockCreatePropertyFromOwnerRez.mockRejectedValueOnce(rawValidationError);

    const result = await createPropertyFromOwnerRezAction(
      IDLE,
      formDataWith("480307"),
    );

    expect(result).toEqual({ status: "failure", error: GENERIC_ERROR });
    expect(result.status === "failure" && result.error).not.toContain(
      "bedroomCount",
    );
    expect(result.status === "failure" && result.error).not.toContain(
      "Invalid `prisma",
    );
  });

  it("replaces a raw PrismaClientKnownRequestError with the generic safe message", async () => {
    const rawDbError = new PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`internal_code`)",
      "P2002",
    );
    mockCreatePropertyFromOwnerRez.mockRejectedValueOnce(rawDbError);

    const result = await createPropertyFromOwnerRezAction(
      IDLE,
      formDataWith("480307"),
    );

    expect(result).toEqual({ status: "failure", error: GENERIC_ERROR });
  });

  it("falls back to the generic safe message for a non-Error thrown value, without crashing", async () => {
    mockCreatePropertyFromOwnerRez.mockRejectedValueOnce("a raw string throw");

    const result = await createPropertyFromOwnerRezAction(
      IDLE,
      formDataWith("480307"),
    );

    expect(result).toEqual({ status: "failure", error: GENERIC_ERROR });
  });

  it("never revalidates the page on any failure path", async () => {
    mockCreatePropertyFromOwnerRez.mockRejectedValueOnce(
      new Error("missing required field(s): bedrooms"),
    );

    await createPropertyFromOwnerRezAction(IDLE, formDataWith("480307"));

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
