import type { ContextFragment, ContextProvider, ContextRequest } from "./types";

const providers = new Map<string, ContextProvider>();

/** Registers a context provider. Re-registering the same name replaces it. */
export function registerContextProvider(provider: ContextProvider): void {
  providers.set(provider.name, provider);
}

export function getRegisteredContextProviders(): ContextProvider[] {
  return [...providers.values()];
}

/**
 * Calls every registered provider concurrently and flattens the results.
 * A provider that throws is dropped rather than failing the whole assembly —
 * a broken context source (e.g. Knowledge Retrieval before it's implemented)
 * should degrade the conversation's context, not block it.
 */
export async function assembleContext(
  req: ContextRequest,
): Promise<ContextFragment[]> {
  const results = await Promise.allSettled(
    [...providers.values()].map((provider) => provider.provide(req)),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}
