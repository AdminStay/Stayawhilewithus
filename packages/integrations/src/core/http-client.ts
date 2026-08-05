export interface HttpClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Shared fetch wrapper for all integration clients: fixed base URL,
 * timeout via AbortController, and exponential-backoff retry on 5xx/network
 * failure (never retries 4xx — those are caller errors, not transient).
 */
export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const maxRetries = this.opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );

      try {
        const response = await fetch(`${this.opts.baseUrl}${path}`, {
          ...init,
          headers: { ...this.opts.headers, ...init.headers },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status < 500 || attempt === maxRetries) {
            throw new Error(
              `Request to ${path} failed with ${response.status}`,
            );
          }
          lastError = new Error(
            `Request to ${path} failed with ${response.status}`,
          );
          continue;
        }

        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        if (attempt === maxRetries) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }
}
