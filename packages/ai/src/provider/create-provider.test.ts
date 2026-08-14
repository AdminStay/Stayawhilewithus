import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

import { ClaudeProviderAdapter } from "./claude-provider";
import { createModelProvider } from "./create-provider";
import { NotConfiguredModelProvider } from "./not-configured-provider";
import { registerModelProviderFactory } from "./registry";

const originalApiKey = process.env.ANTHROPIC_API_KEY;
const originalProviderName = process.env.AI_MODEL_PROVIDER;

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
  if (originalProviderName === undefined) {
    delete process.env.AI_MODEL_PROVIDER;
  } else {
    process.env.AI_MODEL_PROVIDER = originalProviderName;
  }
});

describe("createModelProvider", () => {
  it("returns NotConfiguredModelProvider when ANTHROPIC_API_KEY is unset (default provider: claude)", () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(createModelProvider()).toBeInstanceOf(NotConfiguredModelProvider);
  });

  it("returns ClaudeProviderAdapter when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    expect(createModelProvider()).toBeInstanceOf(ClaudeProviderAdapter);
  });

  it("selects a provider by AI_MODEL_PROVIDER through the registry, not a hardcoded class reference", () => {
    registerModelProviderFactory({
      name: "test-vendor",
      isConfigured: () => true,
      create: () => ({ complete: vi.fn(), completeStream: vi.fn() }),
    });
    process.env.AI_MODEL_PROVIDER = "test-vendor";

    const provider = createModelProvider();

    expect(provider).not.toBeInstanceOf(ClaudeProviderAdapter);
    expect(provider).not.toBeInstanceOf(NotConfiguredModelProvider);
  });

  it("falls back to NotConfiguredModelProvider when AI_MODEL_PROVIDER names an unregistered provider", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AI_MODEL_PROVIDER = "does-not-exist";

    expect(createModelProvider()).toBeInstanceOf(NotConfiguredModelProvider);
  });

  it("falls back to NotConfiguredModelProvider when the selected factory reports itself unconfigured", () => {
    registerModelProviderFactory({
      name: "test-unconfigured",
      isConfigured: () => false,
      create: () => ({ complete: vi.fn(), completeStream: vi.fn() }),
    });
    process.env.AI_MODEL_PROVIDER = "test-unconfigured";

    expect(createModelProvider()).toBeInstanceOf(NotConfiguredModelProvider);
  });

  describe("multiple registered providers coexist without special-casing any of them", () => {
    // Fake factories, not a real second vendor SDK — StayWhile only
    // requires Claude today (see the package README's "Provider subsystem"
    // section). This is what proves createModelProvider() dispatches
    // purely through the registry: two independent, individually
    // configured fakes plus the real Claude factory, all selected by name
    // with no branch anywhere that knows their names in advance.
    const fakeProviderA = { complete: vi.fn(), completeStream: vi.fn() };
    const fakeProviderB = { complete: vi.fn(), completeStream: vi.fn() };

    it("selects each registered factory independently by name", () => {
      registerModelProviderFactory({
        name: "test-vendor-a",
        isConfigured: () => true,
        create: () => fakeProviderA,
      });
      registerModelProviderFactory({
        name: "test-vendor-b",
        isConfigured: () => true,
        create: () => fakeProviderB,
      });

      process.env.AI_MODEL_PROVIDER = "test-vendor-a";
      expect(createModelProvider()).toBe(fakeProviderA);

      process.env.AI_MODEL_PROVIDER = "test-vendor-b";
      expect(createModelProvider()).toBe(fakeProviderB);
    });

    it("each factory's isConfigured check is independent of the others' credentials", () => {
      registerModelProviderFactory({
        name: "test-vendor-configured",
        isConfigured: () => true,
        create: () => fakeProviderA,
      });
      registerModelProviderFactory({
        name: "test-vendor-unconfigured",
        isConfigured: () => false,
        create: () => fakeProviderB,
      });
      delete process.env.ANTHROPIC_API_KEY; // Claude unconfigured too

      process.env.AI_MODEL_PROVIDER = "test-vendor-configured";
      // Selecting the configured fake must not care that Claude, or the
      // other fake, are unconfigured.
      expect(createModelProvider()).toBe(fakeProviderA);
    });

    it("Claude (the real, currently-required provider) still selects normally alongside fakes registered in the same run", () => {
      registerModelProviderFactory({
        name: "test-vendor-c",
        isConfigured: () => true,
        create: () => fakeProviderA,
      });
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.AI_MODEL_PROVIDER = "claude";

      expect(createModelProvider()).toBeInstanceOf(ClaudeProviderAdapter);
    });
  });
});
