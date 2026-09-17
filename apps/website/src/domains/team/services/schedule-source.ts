import "server-only";

/**
 * Server-side, read-only access to Michelle's real VA/team schedule Google
 * Sheet — the exact spreadsheet + tab confirmed by direct inspection (see
 * this domain's README.md). Uses Google's own unauthenticated CSV export
 * endpoint: a single plain GET, no OAuth, no service account, no Google
 * credential of any kind, no write of any kind. This file issues no other
 * request anywhere.
 *
 * Spreadsheet ID and tab gid are the exact values the user supplied
 * 2026-09-16 (see HANDOFF.md Increment 97) — hardcoded here rather than an
 * env var because they identify WHICH real-world sheet this is (like a
 * fixed URL, not a secret), the same way a specific Notion database ID
 * would be; there is no per-environment variant of Michelle's own schedule.
 */
const SPREADSHEET_ID = "1DNMYvmlY-I2rUOERlizjfmbfaw4RGVJDs8yrp_pRVv8";
const SHEET_GID = "583841225";
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

const FETCH_TIMEOUT_MS = 15_000;

export type ScheduleSourceFetchFailureReason =
  "TIMEOUT" | "NON_200" | "EMPTY_RESPONSE" | "NETWORK_ERROR";

export type ScheduleSourceFetchResult =
  | { ok: true; csvText: string }
  | {
      ok: false;
      reason: ScheduleSourceFetchFailureReason;
      detail: string;
    };

/**
 * Never throws — every failure mode is a typed `{ ok: false }` result, so
 * every caller can decide what to show (and what to keep showing from a
 * prior successful fetch) without wrapping this in its own try/catch.
 * Never logs or persists the CSV body itself; the body only ever flows
 * forward in memory to the parser.
 */
export async function fetchScheduleSheetCsv(): Promise<ScheduleSourceFetchResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(EXPORT_URL, {
      method: "GET",
      signal: controller.signal,
      // Never served from Next.js's own data cache — every call here is
      // meant to be a genuinely current read; "how fresh is this" is
      // handled explicitly by schedule.service.ts's own last-known-good
      // snapshot and staleness check, not implicitly by a framework cache
      // silently returning old bytes as if they were current.
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: "NON_200",
        detail: `Export request returned HTTP ${response.status}.`,
      };
    }

    const csvText = await response.text();
    if (csvText.trim().length === 0) {
      return {
        ok: false,
        reason: "EMPTY_RESPONSE",
        detail: "Export request succeeded but returned an empty body.",
      };
    }

    return { ok: true, csvText };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        reason: "TIMEOUT",
        detail: `No response within ${FETCH_TIMEOUT_MS / 1000}s.`,
      };
    }
    return {
      ok: false,
      reason: "NETWORK_ERROR",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
