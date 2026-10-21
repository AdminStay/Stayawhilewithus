import { Badge, Button, Card, StatusIndicator, type Tone } from "@stayw/ui";

import {
  disconnectIntegrationAction,
  syncAugustDevicesAction,
  syncCieloDevicesAction,
} from "../actions";
import { PROVIDER_CLIENT_STATUS } from "../services/integrations.service";
import type { IntegrationConnection } from "../services/integrations.service";

import { SyncNowButton } from "./SyncNowButton";

import { AugustTokenExpiryNotice } from "@/domains/smart-devices/components/AugustTokenExpiryNotice";
import { AUGUST_AUTO_REFRESH_PAUSED_MESSAGE } from "@/domains/smart-devices/lib/august-reauthorization";
import type { AugustTokenExpiry } from "@/domains/smart-devices/lib/august-token-expiry";

/** Only these two providers currently have a real, credential-gated device sync — see smart-devices.service.ts. Every other "real" provider (Notion, OwnerRez, Slack, Asana) is read-only-on-render, with nothing to trigger from this page. */
const SYNC_ACTIONS = {
  AUGUST: syncAugustDevicesAction,
  CIELO: syncCieloDevicesAction,
} as const;

type SyncLog = {
  id: string;
  direction: string;
  status: string;
  recordsProcessed: number;
  startedAt: Date;
};

type ConnectionWithLogs = IntegrationConnection & { syncLogs: SyncLog[] };

const STATUS_TONE: Record<string, Tone> = {
  CONNECTED: "success",
  DISCONNECTED: "neutral",
  ERROR: "error",
  PENDING: "gold",
};

function formatDate(date: Date | null): string {
  return date ? new Date(date).toLocaleString() : "never";
}

export function IntegrationConnectionList({
  connections,
  augustAuthFailedAt = null,
  augustTokenExpiry = null,
  augustShowRenewalSteps = false,
}: {
  connections: ConnectionWithLogs[];
  /** When August last refused the sign-in, if nothing has succeeded since (2026-10-21). */
  augustAuthFailedAt?: string | null;
  /** August login expiry, from AUGUST_TOKEN_EXPIRES_AT (2026-10-21). */
  augustTokenExpiry?: AugustTokenExpiry | null;
  /** Global admins only: show the August renewal steps (2026-10-21). */
  augustShowRenewalSteps?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {connections.map((c) => {
        const clientStatus = PROVIDER_CLIENT_STATUS[c.provider];
        return (
          <Card key={c.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="font-medium text-ink">{c.displayName}</span>
                <p className="mt-0.5 text-xs text-ink-muted">{c.authType}</p>
              </div>
              <StatusIndicator
                label={c.status}
                tone={STATUS_TONE[c.status] ?? "neutral"}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Badge tone={clientStatus === "real" ? "success" : "neutral"}>
                client: {clientStatus}
              </Badge>
            </div>

            <p className="mt-3 text-xs text-ink-muted">
              Last synced {formatDate(c.lastSyncedAt)}
            </p>
            {c.provider === "AUGUST" && augustAuthFailedAt && (
              <p
                role="alert"
                className="mt-1 text-xs font-medium text-error-500"
              >
                {AUGUST_AUTO_REFRESH_PAUSED_MESSAGE} (Refused{" "}
                {formatDate(new Date(augustAuthFailedAt))}.)
              </p>
            )}
            {c.provider === "AUGUST" && augustTokenExpiry && (
              <AugustTokenExpiryNotice
                status={augustTokenExpiry}
                variant="card"
                showRenewalSteps={augustShowRenewalSteps}
                className="mt-1"
              />
            )}
            {c.syncLogs[0]?.status === "FAILED" && (
              <p className="mt-0.5 text-xs text-error-500">
                Last attempt failed {formatDate(c.syncLogs[0].startedAt)}
              </p>
            )}

            {c.syncLogs.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-ink-faint">
                {c.syncLogs.map((log) => (
                  <li key={log.id}>
                    {log.direction} sync — {log.status} — {log.recordsProcessed}{" "}
                    records — {formatDate(log.startedAt)}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-2">
              {c.provider in SYNC_ACTIONS && (
                <SyncNowButton
                  connectionId={c.id}
                  action={SYNC_ACTIONS[c.provider as keyof typeof SYNC_ACTIONS]}
                />
              )}

              {c.status !== "DISCONNECTED" && (
                <form action={disconnectIntegrationAction}>
                  <input type="hidden" name="provider" value={c.provider} />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                  >
                    Disconnect
                  </Button>
                </form>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
