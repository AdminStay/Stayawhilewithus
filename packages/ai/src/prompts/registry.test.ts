import { describe, expect, it } from "vitest";

import { getPrompt, registerPrompt, renderPrompt } from "./registry";

describe("prompt registry", () => {
  it("renders a template by substituting known variables", () => {
    registerPrompt({
      key: "test.greeting",
      version: 1,
      template: "Hello {{name}}, welcome to {{property}}.",
    });

    expect(
      renderPrompt("test.greeting", { name: "Ada", property: "Cabin 3" }),
    ).toBe("Hello Ada, welcome to Cabin 3.");
  });

  it("leaves an unresolved placeholder untouched", () => {
    registerPrompt({
      key: "test.partial",
      version: 1,
      template: "Hello {{name}}, your code is {{code}}.",
    });

    expect(renderPrompt("test.partial", { name: "Ada" })).toBe(
      "Hello Ada, your code is {{code}}.",
    );
  });

  it("looks up a specific version instead of latest when requested", () => {
    registerPrompt({ key: "test.versioned", version: 1, template: "v1" });
    registerPrompt({ key: "test.versioned", version: 2, template: "v2" });

    expect(getPrompt("test.versioned").version).toBe(2);
    expect(getPrompt("test.versioned", 1).version).toBe(1);
  });

  it("throws for an unregistered key", () => {
    expect(() => getPrompt("test.missing")).toThrow(
      /No prompt registered for "test.missing"/,
    );
  });
});
