import { describe, expect, it } from "vitest";

import { createResourceLinkSchema } from "./resource-links.schema";

const baseInput = {
  name: "Pool vendor",
  description: "",
  category: "VENDOR" as const,
  propertyId: "",
};

describe("createResourceLinkSchema — URL safety", () => {
  it("accepts http and https URLs", () => {
    expect(
      createResourceLinkSchema.safeParse({
        ...baseInput,
        url: "https://example.com/vendor",
      }).success,
    ).toBe(true);
    expect(
      createResourceLinkSchema.safeParse({
        ...baseInput,
        url: "http://example.com/vendor",
      }).success,
    ).toBe(true);
  });

  it("rejects a javascript: URL — never stored as a latent XSS vector", () => {
    const result = createResourceLinkSchema.safeParse({
      ...baseInput,
      url: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a data: URL", () => {
    const result = createResourceLinkSchema.safeParse({
      ...baseInput,
      url: "data:text/html,<script>alert(1)</script>",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL string", () => {
    const result = createResourceLinkSchema.safeParse({
      ...baseInput,
      url: "not a url",
    });
    expect(result.success).toBe(false);
  });
});
