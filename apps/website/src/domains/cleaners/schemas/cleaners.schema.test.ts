import { describe, expect, it } from "vitest";

import {
  addCleanerContactSchema,
  assignCleanerSchema,
  createCleanerSchema,
  setCleanerStatusSchema,
  updateCleanerContactSchema,
} from "./cleaners.schema";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("createCleanerSchema", () => {
  it("trims the name and stores the phone normalized to E.164", () => {
    const parsed = createCleanerSchema.parse({
      name: "  Alex Rivera ",
      phone: "(305) 555-0123",
      notes: "",
    });
    expect(parsed).toEqual({
      name: "Alex Rivera",
      phone: "+13055550123",
      notes: "",
    });
  });

  it("rejects a blank name", () => {
    const result = createCleanerSchema.safeParse({
      name: "  ",
      phone: "3055550123",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Name is required.");
  });

  it("rejects an unusable phone with a readable message", () => {
    const result = createCleanerSchema.safeParse({
      name: "Alex",
      phone: "555-0123",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/valid phone number/);
  });
});

describe("assignment / status schemas", () => {
  it("accepts only PRIMARY or TEAM_MEMBER", () => {
    const base = { propertyId: UUID, cleanerId: UUID };
    expect(
      assignCleanerSchema.safeParse({ ...base, role: "PRIMARY" }).success,
    ).toBe(true);
    expect(
      assignCleanerSchema.safeParse({ ...base, role: "TEAM_MEMBER" }).success,
    ).toBe(true);
    expect(
      assignCleanerSchema.safeParse({ ...base, role: "BACKUP" }).success,
    ).toBe(false);
  });

  it("asks to choose a cleaner when none is selected", () => {
    const result = assignCleanerSchema.safeParse({
      propertyId: UUID,
      cleanerId: "",
      role: "PRIMARY",
    });
    expect(result.error?.issues[0]?.message).toBe("Choose a cleaner.");
  });

  it("status is ACTIVE or INACTIVE only (no delete)", () => {
    expect(
      setCleanerStatusSchema.safeParse({ id: UUID, status: "DELETED" }).success,
    ).toBe(false);
  });
});

describe("backup contact schemas", () => {
  it("normalizes the backup phone; name/relationship are optional", () => {
    expect(
      addCleanerContactSchema.parse({
        cleanerId: UUID,
        phone: "(941) 555-0199",
        name: "",
        relationship: "",
      }),
    ).toEqual({
      cleanerId: UUID,
      phone: "+19415550199",
      name: "",
      relationship: "",
    });
  });

  it("rejects an unusable backup phone", () => {
    expect(
      addCleanerContactSchema.safeParse({ cleanerId: UUID, phone: "123" })
        .success,
    ).toBe(false);
  });

  it("update needs the contact id", () => {
    expect(
      updateCleanerContactSchema.safeParse({ phone: "9415550199" }).success,
    ).toBe(false);
  });
});
