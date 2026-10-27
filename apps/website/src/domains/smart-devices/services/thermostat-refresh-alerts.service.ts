import "server-only";

import { prisma } from "@stayw/database";

import {
  NEST_REFRESH_LOG_ENTITY,
  parseNestRefreshFailure,
} from "../lib/nest-health";
import {
  CIELO_REFRESH_LOG_ENTITY,
  decideThermostatRefreshAlert,
  parseCieloRefreshFailure,
  THERMOSTAT_REFRESH_ALERT_FAILURES,
  type ThermostatRefreshAlertReason,
} from "../lib/thermostat-auto-refresh";

import { logThermostatRefresh } from "./thermostat-refresh.service";

import { createNotificationsForGlobalRole } from "@/platform/notifications/create-notification";

/**
 * Admin alerts for the automatic thermostat refresh (2026-10-27) — same
 * mechanism as the OwnerRez sync alert (ownerrez-sync-status.service.ts):
 * one in-app SYSTEM notification per global admin, once per incident.
 * Read-only against the IntegrationSyncLog rows the refresh already writes;
 * no new table.
 *
 * Dedupe: Notification.relatedEntityType is
 * `${THERMOSTAT_REFRESH_ALERT_ENTITY}:<PROVIDER>:<reason>` and
 * relatedEntityId the provider's IntegrationConnection id. An alert for the
 * same provider and reason created after that provider's last successful
 * attempt means the incident is already reported; the next success starts
 * a new incident.
 */
export const THERMOSTAT_REFRESH_ALERT_ENTITY = "ThermostatRefreshAlert";
const RECENT_ATTEMPTS = 10;

type AlertProvider = "NEST" | "CIELO";

const ALERT_TEXT: Record<
  AlertProvider,
  Record<ThermostatRefreshAlertReason, { title: string; body: string }>
> = {
  NEST: {
    auth_failed: {
      title: "Nest authorization expired — thermostat refresh paused",
      body: "Google refused StayWhile's Nest authorization. Nest readings on /thermostats will not update, and automatic Nest refresh is paused, until Nest is reauthorized. After reauthorizing, click Refresh on /thermostats once; automatic refresh resumes after a successful refresh.",
    },
    consecutive_failures: {
      title: "Automatic Nest refresh is failing",
      body: `The last ${THERMOSTAT_REFRESH_ALERT_FAILURES} Nest refresh attempts failed. Nest readings on /thermostats may be out of date. Check /thermostats; the manual Refresh button shows the current error.`,
    },
  },
  CIELO: {
    auth_failed: {
      title: "Cielo sign-in refused — Cielo refresh slowed down",
      body: "Cielo refused StayWhile's sign-in. Cielo readings on /thermostats will not update until the Cielo credentials work again. Automatic refresh retries the sign-in every 6 hours.",
    },
    consecutive_failures: {
      title: "Automatic Cielo refresh is failing",
      body: `The last ${THERMOSTAT_REFRESH_ALERT_FAILURES} automatic Cielo refresh attempts failed. Cielo readings on /thermostats may be out of date.`,
    },
  },
};

export interface ThermostatRefreshAlert {
  provider: AlertProvider;
  reason: ThermostatRefreshAlertReason;
}

async function checkProvider(
  provider: AlertProvider,
  entityType: string,
  isAuthFailure: (errorMessage: string | null) => boolean,
): Promise<ThermostatRefreshAlert | null> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider },
    select: { id: true },
  });
  if (!connection) return null;

  const attempts = await prisma.integrationSyncLog.findMany({
    where: { integrationConnectionId: connection.id, entityType },
    orderBy: { startedAt: "desc" },
    take: RECENT_ATTEMPTS,
    select: {
      status: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
    },
  });
  // The incident starts after the provider's latest success — looked up on
  // its own, however far back (2026-10-28). Taking it from the recent
  // attempts above missed a success older than RECENT_ATTEMPTS, and then an
  // alert from an earlier, resolved incident suppressed the new one. With no
  // success ever, every earlier alert belongs to the same unresolved incident.
  const lastSuccess = await prisma.integrationSyncLog.findFirst({
    where: {
      integrationConnectionId: connection.id,
      entityType,
      status: "SUCCEEDED",
    },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, finishedAt: true },
  });
  const existing = await prisma.notification.findMany({
    where: {
      relatedEntityType: {
        startsWith: `${THERMOSTAT_REFRESH_ALERT_ENTITY}:${provider}:`,
      },
      relatedEntityId: connection.id,
      ...(lastSuccess
        ? { createdAt: { gt: lastSuccess.finishedAt ?? lastSuccess.startedAt } }
        : {}),
    },
    select: { relatedEntityType: true },
    distinct: ["relatedEntityType"],
  });
  const alerted = new Set(existing.map((n) => n.relatedEntityType));

  const reason = decideThermostatRefreshAlert({
    attemptsNewestFirst: attempts,
    isAuthFailure,
    alreadyAlerted: (r) =>
      alerted.has(`${THERMOSTAT_REFRESH_ALERT_ENTITY}:${provider}:${r}`),
  });
  if (!reason) return null;

  const recipients = await createNotificationsForGlobalRole("admin", {
    type: "SYSTEM",
    channel: "IN_APP",
    title: ALERT_TEXT[provider][reason].title,
    body: ALERT_TEXT[provider][reason].body,
    relatedEntityType: `${THERMOSTAT_REFRESH_ALERT_ENTITY}:${provider}:${reason}`,
    relatedEntityId: connection.id,
  });
  logThermostatRefresh("auto_refresh_alert_created", {
    provider,
    reason,
    recipients,
  });
  return { provider, reason };
}

/**
 * Runs after every automatic run (never for manual refreshes). Never throws
 * — monitoring must not break the refresh; a failure is logged by name only.
 */
export async function checkThermostatRefreshHealthAndAlert(): Promise<
  ThermostatRefreshAlert[]
> {
  const alerts: ThermostatRefreshAlert[] = [];
  for (const [provider, entityType, isAuthFailure] of [
    [
      "NEST",
      NEST_REFRESH_LOG_ENTITY,
      (m: string | null) => parseNestRefreshFailure(m) === "NEST_AUTH_EXPIRED",
    ],
    [
      "CIELO",
      CIELO_REFRESH_LOG_ENTITY,
      (m: string | null) => parseCieloRefreshFailure(m) === "CIELO_AUTH_FAILED",
    ],
  ] as const) {
    try {
      const alert = await checkProvider(provider, entityType, isAuthFailure);
      if (alert) alerts.push(alert);
    } catch (err) {
      logThermostatRefresh("auto_refresh_alert_failed", {
        provider,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  }
  return alerts;
}
