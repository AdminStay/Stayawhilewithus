import {
  Badge,
  EmptyState,
  Metric,
  MetricStrip,
  PageHeader,
  SectionHeader,
} from "@stayw/ui";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckSquare,
  DoorOpen,
  Lock,
  LogOut,
  Percent,
  Sparkles,
  Thermometer,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import type { getDashboardSummary } from "../services/dashboard.service";

type Summary = Awaited<ReturnType<typeof getDashboardSummary>>;
type SmartDeviceLike = Summary["smartDevices"][number];

// "On the books" = anything not yet checked out and not cancelled — the
// standard hospitality meaning of confirmed-or-pending future/current stays.
const ON_THE_BOOKS_STATUSES = new Set(["PENDING", "CONFIRMED", "CHECKED_IN"]);

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

/**
 * For @db.Date columns (checkInDate/checkOutDate/scheduledDate/
 * originalScheduledDate) — these are UTC-midnight-anchored date-only values
 * with no meaningful time component. Formatting them with formatDate()'s
 * local-timezone toLocaleString() can shift the displayed day backward by
 * one for any timezone behind UTC. Read the UTC calendar fields directly
 * instead, matching the todayUtc()/isSameUtcDay() convention already used
 * server-side for the same reason.
 */
function formatUtcDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function guestName(
  guest: { firstName: string; lastName: string } | null | undefined,
): string {
  return guest ? `${guest.firstName} ${guest.lastName}` : "Guest";
}

/** Mirrors smart-devices.service.ts's LOW_BATTERY_THRESHOLD — keep in sync with that file if it changes. */
const LOW_BATTERY_THRESHOLD = 20;

/** Mirrors smart-devices.service.ts's getBatteryLevel() — small enough that duplicating it here beats a component importing a service. */
function getBatteryLevel(device: SmartDeviceLike): number | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const level = metadata?.batteryLevel;
  return typeof level === "number" ? level : null;
}

/** Mirrors smart-devices.service.ts's isDemoSmartDevice() — per-row, not per-provider, so a provider having a real client doesn't mislabel a still-seeded row as live. */
function isDemoDevice(device: SmartDeviceLike): boolean {
  return device.externalDeviceId.startsWith("demo-");
}

/**
 * A device can be both offline AND low battery at once — report both
 * facts rather than letting "offline" silently hide a real battery
 * reading, so the client can tell "offline" apart from "offline, also
 * about to die" once real hardware is connected.
 */
function deviceAttentionReason(device: SmartDeviceLike): string {
  const offline = device.status !== "ONLINE";
  const battery = getBatteryLevel(device);
  const lowBattery = battery !== null && battery < LOW_BATTERY_THRESHOLD;

  if (offline && lowBattery) return `Offline, low battery (${battery}%)`;
  if (offline) return "Offline";
  if (lowBattery) return `Low battery (${battery}%)`;
  return "Needs attention";
}

/** Shared hint-line logic for the Locks/Thermostats KPI tiles — same "demo data" honesty rule as the rest of the device-health UI. */
function deviceGroupHint(
  devices: SmartDeviceLike[],
  needingAttentionCount: number,
  hasLiveData: boolean,
): string {
  if (devices.length === 0) return "None connected";
  if (!hasLiveData) {
    return `Demo data — ${needingAttentionCount > 0 ? `${needingAttentionCount} need attention` : "all online"}`;
  }
  return needingAttentionCount > 0
    ? `${needingAttentionCount} need attention`
    : "All online";
}

/** A row inside a borderless list section — the shared shape for Needs Attention / Important Tasks. */
function ListRow({
  href,
  icon: Icon,
  label,
  meta,
  trailing,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  meta?: string;
  trailing?: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 py-3 transition-colors hover:bg-ivory-200/40"
      >
        <Icon className="h-4 w-4 shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {label}
          </span>
          {meta && (
            <span className="block truncate text-xs text-ink-muted">
              {meta}
            </span>
          )}
        </span>
        {trailing}
      </Link>
    </li>
  );
}

export function DashboardSummary({ summary }: { summary: Summary }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const needsAttention = [
    ...summary.devicesNeedingAttention.map((d) => {
      const offline = d.status !== "ONLINE";
      const battery = getBatteryLevel(d);
      const lowBattery = battery !== null && battery < LOW_BATTERY_THRESHOLD;
      return {
        id: `device-${d.id}`,
        icon: d.deviceType === "LOCK" ? Lock : Thermometer,
        // Offline is the more severe condition — takes the error tone even
        // when the device is also low battery.
        tone: offline ? ("error" as const) : ("warning" as const),
        label: `${d.name} — ${d.property.name}`,
        meta: deviceAttentionReason(d),
        // Explicit per-item text — deriving this from `tone` alone (as a
        // prior version did) mislabeled a low-battery-but-online device
        // with the maintenance-request-only "Open" badge text, and
        // couldn't represent "offline AND low battery" at all.
        badgeLabel:
          offline && lowBattery
            ? "Offline + low battery"
            : offline
              ? "Offline"
              : "Low battery",
        // No dedicated device-management page exists yet (out of scope — the
        // client's ask was status visibility, not device control) — link to
        // the property instead of a dead self-link back to the dashboard.
        href: "/properties",
        isDemo: isDemoDevice(d),
      };
    }),
    ...summary.openMaintenanceRequests.map((m) => ({
      id: `maint-${m.id}`,
      icon: Wrench,
      tone: "warning" as const,
      label: m.description,
      meta: m.property?.name,
      badgeLabel: "Open",
      href: "/maintenance",
    })),
    ...summary.pendingAiActions.map((a) => ({
      id: `ai-${a.id}`,
      icon: Bot,
      tone: "gold" as const,
      label: a.toolName,
      meta: "Awaiting approval",
      badgeLabel: "Pending",
      href: "/ai",
    })),
  ];

  const importantTasks = [
    ...summary.tasksDueToday.map((t) => ({
      id: `task-${t.id}`,
      icon: CheckSquare,
      label: t.title,
      meta: t.property?.name,
      href: "/tasks",
    })),
    ...summary.cleaningToday.map((c) => ({
      id: `clean-${c.id}`,
      icon: Sparkles,
      label: `Turnover clean — ${c.property?.name ?? "Property"}`,
      meta: "Due today",
      href: "/cleaning",
    })),
  ];

  const atAGlance = [
    {
      label: "Properties",
      value: summary.properties.length,
      href: "/properties",
    },
    { label: "Open tasks", value: summary.openTasks.length, href: "/tasks" },
    {
      label: "Upcoming cleanings",
      value: summary.upcomingCleaningSchedules.length,
      href: "/cleaning",
    },
    {
      label: "Message threads",
      value: summary.messageThreads.length,
      href: "/communications",
    },
    {
      label: "Integrations connected",
      value: summary.connectedIntegrations.length,
      href: "/integrations",
    },
  ];

  // Split out per client instruction: locks and thermostats are distinct
  // operational questions ("is a lock offline" vs "is a thermostat
  // offline"), not one merged "device health" number.
  const locksOnline = summary.locks.filter((d) => d.status === "ONLINE").length;
  const locksNeedingAttention = summary.devicesNeedingAttention.filter(
    (d) => d.deviceType === "LOCK",
  ).length;
  const thermostatsOnline = summary.thermostats.filter(
    (d) => d.status === "ONLINE",
  ).length;
  const thermostatsNeedingAttention = summary.devicesNeedingAttention.filter(
    (d) => d.deviceType === "THERMOSTAT",
  ).length;

  return (
    <section>
      <PageHeader
        title="Dashboard"
        subtitle="Today's operational overview, across every property."
        actions={<span className="text-sm text-ink-muted">{today}</span>}
      />

      {/* Primary metrics — the one elevated surface on this page. Everything below is composed with typography and spacing, not more boxes. Revenue/ADR live on the Reservations page per current priority — this band stays operational, not financial. */}
      <MetricStrip xlColumns={6}>
        <Metric
          label="Occupancy"
          value={`${Math.round(summary.occupancyRate * 100)}%`}
          icon={Percent}
          hint={`${summary.occupiedPropertyCount} of ${summary.properties.length} properties`}
          href="/properties"
        />
        <Metric
          label="Check-ins today"
          value={summary.arrivalsToday.length}
          icon={DoorOpen}
          href="/reservations"
        />
        <Metric
          label="Check-outs today"
          value={summary.departuresToday.length}
          icon={LogOut}
          href="/reservations"
        />
        <Metric
          label="On the books"
          value={
            summary.reservations.filter((r) =>
              ON_THE_BOOKS_STATUSES.has(r.status),
            ).length
          }
          icon={CalendarClock}
          hint="Pending, confirmed & in-house"
          href="/reservations"
        />
        <Metric
          label="Locks"
          value={`${locksOnline}/${summary.locks.length}`}
          icon={Lock}
          hint={deviceGroupHint(
            summary.locks,
            locksNeedingAttention,
            summary.hasLiveDeviceData,
          )}
        />
        <Metric
          label="Thermostats"
          value={`${thermostatsOnline}/${summary.thermostats.length}`}
          icon={Thermometer}
          hint={deviceGroupHint(
            summary.thermostats,
            thermostatsNeedingAttention,
            summary.hasLiveDeviceData,
          )}
        />
      </MetricStrip>

      <div className="mt-10 grid gap-x-10 gap-y-10 lg:grid-cols-3">
        {/* Attention & action items — the highest-weight content section after the metrics themselves. */}
        <div className="space-y-10 lg:col-span-2">
          <div>
            <SectionHeader
              title="Needs Attention"
              size="lg"
              description={
                needsAttention.length > 0
                  ? `${needsAttention.length} item${needsAttention.length === 1 ? "" : "s"} waiting on you`
                  : undefined
              }
            />
            {needsAttention.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="Nothing needs attention"
                description="Offline/low-battery devices, open maintenance requests, and pending AI actions will show up here."
              />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {needsAttention.map((item) => (
                  <ListRow
                    key={item.id}
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    meta={item.meta}
                    trailing={
                      <span className="flex shrink-0 items-center gap-1.5">
                        {"isDemo" in item && item.isDemo && (
                          <Badge tone="neutral">Demo data</Badge>
                        )}
                        <Badge tone={item.tone}>{item.badgeLabel}</Badge>
                      </span>
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeader title="Important Tasks" />
            {importantTasks.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing due today.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {importantTasks.map((item) => (
                  <ListRow
                    key={item.id}
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    meta={item.meta}
                  />
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeader title="Rescheduled Cleanings" />
            {summary.recentlyRescheduledCleanings.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No rescheduled cleanings.
              </p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {summary.recentlyRescheduledCleanings.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-3">
                    <Sparkles className="h-4 w-4 shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {c.property.name}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {c.originalScheduledDate && (
                          <>was {formatUtcDate(c.originalScheduledDate)} → </>
                        )}
                        now {formatUtcDate(c.scheduledDate)}
                      </span>
                    </span>
                    <Badge tone="gold">{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(summary.arrivalsToday.length > 0 ||
            summary.departuresToday.length > 0) && (
            <div>
              <SectionHeader title="Today's Check-ins & Check-outs" />
              <div className="grid divide-y divide-border rounded-card border border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="p-5">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Arriving today
                  </h3>
                  {summary.arrivalsToday.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      No arrivals today.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-ink">
                      {summary.arrivalsToday.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between"
                        >
                          <span>{guestName(r.primaryGuest)}</span>
                          <span className="text-ink-muted">
                            {r.property?.name ?? "Property"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Checking out today
                  </h3>
                  {summary.departuresToday.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      No check-outs today.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-ink">
                      {summary.departuresToday.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between"
                        >
                          <span>{guestName(r.primaryGuest)}</span>
                          <span className="text-ink-muted">
                            {r.property?.name ?? "Property"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {(summary.upcomingCheckIns.length > 0 ||
            summary.upcomingCheckOuts.length > 0) && (
            <div>
              <SectionHeader
                title="Coming Up"
                description="Next few days, beyond today"
              />
              <div className="grid divide-y divide-border rounded-card border border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="p-5">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Upcoming check-ins
                  </h3>
                  {summary.upcomingCheckIns.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      No upcoming check-ins.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-ink">
                      {summary.upcomingCheckIns.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0 truncate">
                            {guestName(r.primaryGuest)}
                          </span>
                          <span className="shrink-0 text-right text-xs text-ink-muted">
                            {r.property?.name ?? "Property"}
                            <br />
                            {formatUtcDate(r.checkInDate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Upcoming check-outs
                  </h3>
                  {summary.upcomingCheckOuts.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      No upcoming check-outs.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-ink">
                      {summary.upcomingCheckOuts.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0 truncate">
                            {guestName(r.primaryGuest)}
                          </span>
                          <span className="shrink-0 text-right text-xs text-ink-muted">
                            {r.property?.name ?? "Property"}
                            <br />
                            {formatUtcDate(r.checkOutDate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Supporting information — deliberately quieter than the left column. */}
        <div className="space-y-10">
          <Link
            href="/ai"
            className="block rounded-card bg-gradient-to-br from-gold-50 to-ivory-100 p-4 transition-colors hover:from-gold-100"
          >
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 shrink-0 text-gold-600" />
              <div className="min-w-0">
                <p className="font-display text-[15px] font-semibold text-ink">
                  AI Assistant
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {summary.pendingAiActions.length > 0
                    ? `${summary.pendingAiActions.length} action${summary.pendingAiActions.length === 1 ? "" : "s"} awaiting your approval`
                    : "Ask about arrivals, tasks, or anything operational"}
                </p>
              </div>
            </div>
          </Link>

          <div>
            <SectionHeader title="Notion" />
            {summary.notionHighlights.configured === false ? (
              <p className="text-sm text-ink-muted">
                Not connected — set{" "}
                <code className="text-xs">NOTION_API_KEY</code> to enable.
              </p>
            ) : summary.notionHighlights.ok === false ? (
              <p className="text-sm text-error-500">
                Couldn&apos;t reach Notion: {summary.notionHighlights.error}
              </p>
            ) : summary.notionHighlights.items.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No pages/databases found.
              </p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {summary.notionHighlights.items.map((item) => (
                  <li key={item.id}>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate py-2 text-sm text-ink-muted transition-colors hover:text-ink"
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span className="block truncate py-2 text-sm text-ink-muted">
                        {item.title}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeader title="OwnerRez" />
            {summary.ownerRezHighlights.configured === false ? (
              <p className="text-sm text-ink-muted">
                Not connected — set{" "}
                <code className="text-xs">OWNERREZ_USERNAME</code> and{" "}
                <code className="text-xs">OWNERREZ_API_TOKEN</code> to enable.
              </p>
            ) : summary.ownerRezHighlights.ok === false ? (
              <p className="text-sm text-error-500">
                Couldn&apos;t reach OwnerRez: {summary.ownerRezHighlights.error}
              </p>
            ) : summary.ownerRezHighlights.items.length === 0 ? (
              <p className="text-sm text-ink-muted">No bookings found.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border text-sm">
                {summary.ownerRezHighlights.items.map((b) => (
                  <li key={b.id} className="py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-ink">Booking #{b.id}</span>
                      <Badge tone="neutral">{b.status}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {b.arrival} → {b.departure}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeader
              title="Recent Activity"
              action={
                <Link
                  href="/ai"
                  className="text-xs font-medium text-forest-600 hover:underline"
                >
                  View all
                </Link>
              }
            />
            {summary.recentAiConversations.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No activity yet — ask the AI assistant something.
              </p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {summary.recentAiConversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/ai?conversationId=${c.id}`}
                      className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:bg-ivory-200/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {c.subject || c.messages[0]?.content || "(empty)"}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {formatDate(c.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeader title="At a Glance" />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {atAGlance.map((row) => (
                <li key={row.label}>
                  <Link
                    href={row.href}
                    className="flex items-center justify-between py-2 text-ink-muted transition-colors hover:text-ink"
                  >
                    {row.label}
                    <span className="font-medium text-ink">{row.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
