"use client";

import { Button } from "@stayw/ui";
import { useActionState } from "react";

import type {
  ProviderRefreshOutcome,
  RefreshThermostatsActionState,
} from "../actions";

const INITIAL_STATE: RefreshThermostatsActionState = { status: "idle" };

const PROVIDER_LABEL: Record<ProviderRefreshOutcome["provider"], string> = {
  NEST: "Nest",
  CIELO: "Cielo",
};

/** One provider's own line — never merges a success and a failure into one ambiguous message. */
function describeProviderOutcome(outcome: ProviderRefreshOutcome): string {
  const label = PROVIDER_LABEL[outcome.provider];

  if (outcome.status === "success") {
    const parts = [
      `${label}: ${outcome.refreshed} device${outcome.refreshed === 1 ? "" : "s"} refreshed`,
    ];
    if (outcome.notReturnedByProvider > 0) {
      parts.push(
        `${outcome.notReturnedByProvider} not returned by provider this time`,
      );
    }
    return `${parts.join(", ")}.`;
  }
  if (outcome.status === "not_configured") {
    return `${label}: not connected — nothing to refresh.`;
  }
  return `${label}: refresh failed — ${outcome.error}`;
}

/** Only "success" with at least one provider actually refreshed counts as unambiguously green; any real provider failure tips the summary tone amber/red instead of masking it as an overall success. */
function summaryTone(providers: ProviderRefreshOutcome[]): string {
  const anyFailure = providers.some((p) => p.status === "failure");
  const anySuccess = providers.some((p) => p.status === "success");
  if (anyFailure && anySuccess) return "text-warning-600";
  if (anyFailure) return "text-error-500";
  return "text-success-600";
}

/**
 * The single Refresh control for /thermostats. Fetches current telemetry
 * from every configured thermostat provider and writes it into StayWhile's
 * database — it never changes a physical device's temperature, mode, fan,
 * or schedule, and never creates or changes a device mapping (see
 * thermostat-refresh.service.ts for the full read/write boundary this
 * button triggers). One action, one button — orchestrates every configured
 * provider internally; there is deliberately no separate Nest/Cielo button
 * in this UI. isPending both disables the button and swaps its label,
 * which is what prevents a duplicate click from starting a second refresh
 * while one is already running — same mechanism already used by
 * DiscoverDevicesButton/SyncNowButton elsewhere in this app.
 */
export function RefreshThermostatsButton({
  action,
}: {
  action: (
    prevState: RefreshThermostatsActionState,
    formData: FormData,
  ) => Promise<RefreshThermostatsActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="primary" size="sm" disabled={isPending}>
        {isPending ? "Refreshing…" : "Refresh"}
      </Button>

      {!isPending && state.status === "success" && (
        <div className={`text-right text-xs ${summaryTone(state.providers)}`}>
          {state.providers.map((outcome) => (
            <p key={outcome.provider}>{describeProviderOutcome(outcome)}</p>
          ))}
          <p className="text-ink-muted">
            Last refreshed: {new Date(state.refreshedAt).toLocaleString()}
          </p>
        </div>
      )}

      {!isPending && state.status === "failure" && (
        <p className="text-xs text-error-500">Refresh failed: {state.error}</p>
      )}
    </form>
  );
}
