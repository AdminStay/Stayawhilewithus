import { describe, expect, it, vi } from "vitest";

import {
  assembleContext,
  getRegisteredContextProviders,
  registerContextProvider,
} from "./registry";

describe("context registry", () => {
  it("assembles fragments from every registered provider", async () => {
    registerContextProvider({
      name: "test-provider-a",
      provide: async () => [{ source: "a", content: "fragment-a" }],
    });
    registerContextProvider({
      name: "test-provider-b",
      provide: async () => [{ source: "b", content: "fragment-b" }],
    });

    const fragments = await assembleContext({});
    const sources = fragments.map((f) => f.source);

    expect(sources).toContain("a");
    expect(sources).toContain("b");
  });

  it("drops a provider that throws instead of failing the whole assembly", async () => {
    registerContextProvider({
      name: "test-provider-broken",
      provide: async () => {
        throw new Error("boom");
      },
    });
    registerContextProvider({
      name: "test-provider-healthy",
      provide: async () => [{ source: "healthy", content: "ok" }],
    });

    const fragments = await assembleContext({});

    expect(fragments.some((f) => f.source === "healthy")).toBe(true);
  });

  it("replaces a provider registered again under the same name", () => {
    const first = vi.fn(async () => []);
    const second = vi.fn(async () => []);
    registerContextProvider({ name: "test-provider-replace", provide: first });
    registerContextProvider({ name: "test-provider-replace", provide: second });

    const registered = getRegisteredContextProviders().filter(
      (p) => p.name === "test-provider-replace",
    );
    expect(registered).toHaveLength(1);
    expect(registered[0]?.provide).toBe(second);
  });
});
