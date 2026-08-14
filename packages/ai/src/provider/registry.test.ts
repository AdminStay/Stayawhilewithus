import { describe, expect, it, vi } from "vitest";

import {
  getModelProviderFactory,
  listModelProviderFactories,
  registerModelProviderFactory,
} from "./registry";

describe("registerModelProviderFactory / getModelProviderFactory / listModelProviderFactories", () => {
  it("lists every registered provider factory", () => {
    registerModelProviderFactory({
      name: "test.listed",
      isConfigured: () => true,
      create: () => ({ complete: vi.fn(), completeStream: vi.fn() }),
    });

    expect(listModelProviderFactories().map((f) => f.name)).toContain(
      "test.listed",
    );
    expect(getModelProviderFactory("test.listed")?.name).toBe("test.listed");
  });

  it("re-registering the same name replaces the factory", () => {
    const first = {
      name: "test.replaced",
      isConfigured: () => true,
      create: () => ({ complete: vi.fn(), completeStream: vi.fn() }),
    };
    const second = {
      name: "test.replaced",
      isConfigured: () => false,
      create: () => ({ complete: vi.fn(), completeStream: vi.fn() }),
    };

    registerModelProviderFactory(first);
    registerModelProviderFactory(second);

    expect(getModelProviderFactory("test.replaced")).toBe(second);
    expect(
      listModelProviderFactories().filter((f) => f.name === "test.replaced"),
    ).toHaveLength(1);
  });

  it("returns undefined for an unregistered provider name", () => {
    expect(getModelProviderFactory("test.nonexistent")).toBeUndefined();
  });
});
