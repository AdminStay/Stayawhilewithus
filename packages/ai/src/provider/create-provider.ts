import "server-only";

// Imported only for its module-load side effect — registering the "claude"
// factory (see claude-provider.ts's bottom). This is the *one* line in this
// file that knows a vendor named "claude" exists; everything below it works
// purely through the registry. StayWhile only requires Claude today — see
// this package's README ("Provider subsystem") for exactly what adding a
// real second vendor would involve, when one is actually needed.
import "./claude-provider";
import { NotConfiguredModelProvider } from "./not-configured-provider";
import { getModelProviderFactory } from "./registry";
import type { ModelProvider } from "./types";

const DEFAULT_PROVIDER_NAME = "claude";

/**
 * The one place that decides which ModelProvider a caller gets. Picks a
 * registered factory by name (AI_MODEL_PROVIDER env var, defaulting to
 * "claude") and falls back to NotConfiguredModelProvider when that factory
 * either isn't registered or reports itself unconfigured (missing
 * credential). Nothing here constructs a vendor class directly — swapping
 * the default provider, or supporting a per-request choice later, only
 * ever changes this function.
 */
export function createModelProvider(): ModelProvider {
  const providerName = process.env.AI_MODEL_PROVIDER || DEFAULT_PROVIDER_NAME;
  const factory = getModelProviderFactory(providerName);

  if (!factory || !factory.isConfigured()) {
    return new NotConfiguredModelProvider();
  }

  return factory.create();
}
