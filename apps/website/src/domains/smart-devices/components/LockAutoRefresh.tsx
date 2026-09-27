"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatTimestamp } from "../lib/format-timestamp";

/** How often an open, visible /locks page asks the server whether a refresh is due. The server's own 10-minute gate decides. */
export const LOCK_AUTO_REFRESH_POLL_MS = 60_000;
/** Beyond this, "Updated X min ago" is shown as possibly out of date (twice the 10-minute target). */
export const LOCK_FRESHNESS_WARN_MS = 20 * 60 * 1000;

interface RefreshIfStaleResponse {
  status: string;
  lastSucceededAt: string | null;
  cooldownUntil: string | null;
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
}

/**
 * Refresh-on-view for /locks (2026-09-27). While the page is open and the
 * tab visible, asks POST /api/locks/refresh-if-stale on load and every
 * minute; the server starts a read-only fleet refresh only when none has
 * started in 10 minutes (global, whatever the number of viewers), and never
 * during a 429 cooldown. When a refresh completes, the page data reloads.
 * Never part of the page render, never a command, no request body.
 */
export function LockAutoRefresh({
  initialLastSucceededAt,
  initialCooldownUntil,
  endpoint = "/api/locks/refresh-if-stale",
  pollIntervalMs = LOCK_AUTO_REFRESH_POLL_MS,
}: {
  initialLastSucceededAt: string | null;
  initialCooldownUntil: string | null;
  endpoint?: string;
  pollIntervalMs?: number;
}) {
  const router = useRouter();
  const [lastSucceededAt, setLastSucceededAt] = useState(
    initialLastSucceededAt,
  );
  const [cooldownUntil, setCooldownUntil] = useState(initialCooldownUntil);
  // null until mounted: relative ages are client-only, so server and client
  // HTML match (the server renders the absolute time).
  const [now, setNow] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    setChecking(true);
    try {
      const res = await fetch(endpoint, { method: "POST", cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as RefreshIfStaleResponse;
      setLastSucceededAt(body.lastSucceededAt);
      setCooldownUntil(body.cooldownUntil);
      if (body.status === "completed" || body.status === "rate_limited") {
        router.refresh();
      }
    } catch {
      // Network blip: the next tick simply asks again.
    } finally {
      inFlight.current = false;
      setChecking(false);
      setNow(Date.now());
    }
  }, [endpoint, router]);

  useEffect(() => {
    setNow(Date.now());
    void check();
    const timer = setInterval(() => {
      setNow(Date.now());
      void check();
    }, pollIntervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check, pollIntervalMs]);

  const lastMs = lastSucceededAt ? Date.parse(lastSucceededAt) : null;
  const age = now !== null && lastMs !== null ? now - lastMs : null;
  const stale = age !== null && age > LOCK_FRESHNESS_WARN_MS;
  const cooling =
    cooldownUntil !== null && (now === null || Date.parse(cooldownUntil) > now);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Clock className="h-3 w-3 text-ink-faint" />
      <span
        className={stale ? "font-medium text-warning-600" : "text-ink-muted"}
      >
        {lastSucceededAt === null
          ? "Lock data not refreshed yet"
          : age !== null
            ? `Updated ${formatAge(age)}`
            : `Updated ${formatTimestamp(new Date(lastSucceededAt))}`}
        {stale && " — may be out of date"}
      </span>
      {checking && <span className="text-ink-faint">· checking…</span>}
      {cooling ? (
        <span className="text-warning-600">
          · August asked us to slow down — auto-refresh paused until{" "}
          {formatTimestamp(new Date(cooldownUntil))}
        </span>
      ) : (
        <span className="text-ink-faint">
          · Auto-refreshes about every 10 min while this page is open
        </span>
      )}
    </div>
  );
}
