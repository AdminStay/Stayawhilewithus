import type { ModelProvider } from "./types";

/**
 * What a vendor adapter registers to make itself selectable at runtime.
 * `isConfigured` lets createModelProvider() check for a usable credential
 * without constructing the provider (and without this registry needing to
 * know what "configured" means for any given vendor — that's the vendor's
 * own business).
 */
export interface ModelProviderFactory {
  name: string;
  isConfigured(): boolean;
  create(): ModelProvider;
}

/**
 * Runtime catalog of available model providers — the mechanism that makes
 * this package "a reusable AI runtime, not a Claude wrapper." Mirrors the
 * Tool Registry and Prompt Management registries elsewhere in this package:
 * a vendor adapter (e.g. ../provider/claude-provider.ts) registers itself
 * once; createModelProvider() (./create-provider.ts) is the only consumer,
 * selecting by name without ever importing a concrete vendor class.
 */
const factories = new Map<string, ModelProviderFactory>();

/** Re-registering the same name replaces it. */
export function registerModelProviderFactory(
  factory: ModelProviderFactory,
): void {
  factories.set(factory.name, factory);
}

export function getModelProviderFactory(
  name: string,
): ModelProviderFactory | undefined {
  return factories.get(name);
}

export function listModelProviderFactories(): ModelProviderFactory[] {
  return [...factories.values()];
}
