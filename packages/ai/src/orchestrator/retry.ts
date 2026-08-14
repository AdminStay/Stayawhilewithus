import { createLogger } from "../logging/logger";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 250;

const logger = createLogger("orchestrator.retry");

function hasNumericStatus(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  );
}

/**
 * 429 (rate limited) and 5xx are transient — retry them. No status at all
 * usually means a network/timeout failure — also worth a retry. Any other
 * 4xx is a caller error (bad request, auth failure, etc.) and never gets
 * retried, same stance as @stayw/integrations' HttpClient.
 */
export function defaultIsRetryable(error: unknown): boolean {
  if (!hasNumericStatus(error)) return true;
  return error.status === 429 || error.status >= 500;
}

/** Exponential-backoff retry for any async operation — used around Model Provider calls; provider-agnostic, so it works for any ModelProvider implementation, not just Claude's. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !isRetryable(err)) {
        throw err;
      }
      const delayMs = initialDelayMs * 2 ** attempt;
      logger.warn("retrying after transient failure", {
        attempt: attempt + 1,
        maxRetries,
        delayMs,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
