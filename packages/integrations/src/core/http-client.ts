export interface HttpClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Thrown by HttpClient.request() on any non-2xx response. `message` stays
 * exactly `Request to ${path} failed with ${status}` — the same string
 * every existing caller's translateXCommandError() already string-matches
 * on (e.g. `.includes("401")`) — so this is a drop-in replacement for the
 * plain Error it used to throw. `providerErrorCode`/`providerMessage` are
 * new, optional, best-effort detail extracted from the response body (see
 * extractSafeErrorDetail below) for callers that want to distinguish
 * *why* a given status happened without having to guess from the code
 * alone — e.g. telling an account-wide auth failure apart from a provider
 * refusing one specific device/operation.
 */
export class HttpRequestError extends Error {
  readonly status: number;
  readonly providerErrorCode?: string;
  readonly providerMessage?: string;

  constructor(
    path: string,
    status: number,
    detail?: { providerErrorCode?: string; providerMessage?: string },
  ) {
    super(`Request to ${path} failed with ${status}`);
    this.name = "HttpRequestError";
    this.status = status;
    this.providerErrorCode = detail?.providerErrorCode;
    this.providerMessage = detail?.providerMessage;
  }
}

const MAX_ERROR_FIELD_LENGTH = 300;

/**
 * Field names a REST error body commonly uses for a machine-readable code
 * and a human-readable message, checked in this order (first present
 * wins). Deliberately a short, explicit allowlist — this only ever reads
 * TOP-LEVEL string/number fields by exact name, never walks the object
 * looking for "anything error-shaped," so it can never accidentally surface
 * something like a nested `pins`/`OfflineKeys`/token blob just because it
 * shares a body with a field named "error".
 */
const ERROR_CODE_FIELDS = ["code", "error_code", "Code", "ErrorCode"];
const ERROR_MESSAGE_FIELDS = [
  "message",
  "Message",
  "error",
  "error_description",
  "Error",
  "ErrorMessage",
];

/**
 * Belt-and-suspenders on top of the allowlist above: even an allowlisted
 * field name is dropped if it happens to look sensitive, so extending
 * either list later can't quietly start leaking a credential-shaped value.
 * Never logs/returns anything for these regardless of where it appears —
 * access tokens, install IDs, auth headers, cookies, PINs/access codes,
 * OfflineKeys, or any other Bluetooth/credential material.
 */
const SENSITIVE_KEY_PATTERN =
  /token|secret|key|pin|password|auth|cookie|credential/i;

function safeStringField(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string | undefined {
  for (const key of fieldNames) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const str = String(value).slice(0, MAX_ERROR_FIELD_LENGTH);
      if (str.length > 0) return str;
    }
  }
  return undefined;
}

/**
 * Best-effort, safe-only extraction from a non-2xx response body — never
 * throws, never returns anything beyond the two allowlisted fields above.
 * Reads the body via `.text()` (not `.json()`) so a non-JSON error body
 * (HTML error page, empty body, plain text) degrades to "no detail"
 * instead of throwing a second error that would mask the real one.
 */
async function extractSafeErrorDetail(
  response: Response,
): Promise<{ providerErrorCode?: string; providerMessage?: string }> {
  let body: unknown;
  try {
    const text = await response.text();
    if (!text) return {};
    body = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  const record = body as Record<string, unknown>;
  return {
    providerErrorCode: safeStringField(record, ERROR_CODE_FIELDS),
    providerMessage: safeStringField(record, ERROR_MESSAGE_FIELDS),
  };
}

export interface HttpRequestCallOptions {
  /**
   * Per-call override of this client's own configured retry count
   * (2026-09-25, the Orion incident's root-cause correction) — for a
   * physical write command (August lock/unlock/unlatch), a network-level
   * abort/timeout must never silently retransmit the same command, since
   * we'd have no way to know whether an earlier attempt already reached
   * the provider/lock. Callers making a real physical write pass
   * `{ maxRetries: 0 }` here so that command gets at most one outbound
   * attempt, while every other call on the same HttpClient instance
   * (reads: getLockDetail, getLockCapabilities, listLocks, etc.) keeps
   * this client's normal configured retry behavior untouched, since they
   * simply omit this option. This is a per-call opt-in, never a global
   * default change — see AugustClient.operate()'s own doc comment for the
   * one real caller that uses it.
   */
  maxRetries?: number;
}

/**
 * Shared fetch wrapper for all integration clients: fixed base URL,
 * timeout via AbortController, and exponential-backoff retry on 5xx/network
 * failure (never retries 4xx — those are caller errors, not transient).
 */
export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async request<T>(
    path: string,
    init: RequestInit = {},
    callOptions: HttpRequestCallOptions = {},
  ): Promise<T> {
    const maxRetries =
      callOptions.maxRetries ?? this.opts.maxRetries ?? DEFAULT_MAX_RETRIES;
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
          const detail = await extractSafeErrorDetail(response);
          const error = new HttpRequestError(path, response.status, detail);
          if (response.status < 500 || attempt === maxRetries) {
            throw error;
          }
          lastError = error;
          continue;
        }

        return (await response.json()) as T;
      } catch (err) {
        // A 4xx thrown just above is deliberate and final — rethrow it
        // immediately, never through the retry path below. Without this
        // check it would fall into the same catch as a genuine network
        // exception, which only looks at `attempt === maxRetries`, so a
        // 4xx (e.g. this integration's real 403 on an unsupported
        // remote-operate call) would get retried up to maxRetries times
        // despite this class's own "never retries 4xx" contract — a real
        // bug this check fixes, found via HttpRequestError's own test
        // coverage (2026-09-18).
        if (err instanceof HttpRequestError && err.status < 500) {
          throw err;
        }
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
