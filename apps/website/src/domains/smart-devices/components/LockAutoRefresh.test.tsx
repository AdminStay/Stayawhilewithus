// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { LockAutoRefresh } from "./LockAutoRefresh";

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

function respond(body: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("LockAutoRefresh (2026-09-27 refresh-on-view)", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    setVisibility("visible");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("on load, POSTs the gated endpoint once (no body) and shows 'Updated X min ago'", async () => {
    const fetchMock = respond({
      status: "fresh",
      lastSucceededAt: minutesAgo(3),
      cooldownUntil: null,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LockAutoRefresh
        initialLastSucceededAt={minutesAgo(3)}
        initialCooldownUntil={null}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/locks/refresh-if-stale", {
      method: "POST",
      cache: "no-store",
    });
    expect(await screen.findByText("Updated 3 min ago")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("reloads the page data only when the server actually completed a refresh", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        status: "completed",
        lastSucceededAt: minutesAgo(0),
        cooldownUntil: null,
      }),
    );
    render(
      <LockAutoRefresh
        initialLastSucceededAt={minutesAgo(40)}
        initialCooldownUntil={null}
      />,
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Updated just now")).toBeTruthy();
  });

  it("flags data older than 20 minutes as possibly out of date", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        status: "already_running",
        lastSucceededAt: minutesAgo(45),
        cooldownUntil: null,
      }),
    );
    render(
      <LockAutoRefresh
        initialLastSucceededAt={minutesAgo(45)}
        initialCooldownUntil={null}
      />,
    );
    expect(await screen.findByText(/Updated 45 min ago/)).toBeTruthy();
    expect(screen.getByText(/may be out of date/)).toBeTruthy();
  });

  it("explains an active August rate-limit cooldown", async () => {
    const until = new Date(Date.now() + 20 * 60_000).toISOString();
    vi.stubGlobal(
      "fetch",
      respond({
        status: "cooldown",
        lastSucceededAt: minutesAgo(12),
        cooldownUntil: until,
      }),
    );
    render(
      <LockAutoRefresh
        initialLastSucceededAt={minutesAgo(12)}
        initialCooldownUntil={until}
      />,
    );
    expect(
      await screen.findByText(/August asked us to slow down/),
    ).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("a hidden tab never asks the server", async () => {
    setVisibility("hidden");
    const fetchMock = respond({ status: "fresh" });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LockAutoRefresh
        initialLastSucceededAt={null}
        initialCooldownUntil={null}
      />,
    );
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Lock data not refreshed yet")).toBeTruthy();
  });

  it("asks again each poll interval, but never while its previous request is still in flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolveFetch) => {
          release = () =>
            resolveFetch(
              new Response(
                JSON.stringify({
                  status: "fresh",
                  lastSucceededAt: minutesAgo(1),
                  cooldownUntil: null,
                }),
              ),
            );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LockAutoRefresh
        initialLastSucceededAt={minutesAgo(1)}
        initialCooldownUntil={null}
        pollIntervalMs={1000}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    // Still in flight: the 3 interval ticks were skipped.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
