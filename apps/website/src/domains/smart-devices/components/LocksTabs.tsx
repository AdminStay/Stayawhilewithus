import Link from "next/link";

/**
 * /locks sections (2026-09-30, three-way separation). Plain links to
 * `?tab=…`, so each tab is a server render with its own URL and nothing is
 * hidden client-side. Unknown values fall back to Fleet Status.
 */
export type LocksTab = "fleet" | "report" | "verification";

export const LOCKS_TABS: { id: LocksTab; label: string }[] = [
  { id: "fleet", label: "Fleet Status" },
  { id: "report", label: "Daily Lock Report" },
  { id: "verification", label: "Remote-Control Verification" },
];

export function parseLocksTab(value: string | string[] | undefined): LocksTab {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "report" || v === "verification" ? v : "fleet";
}

export function LocksTabs({
  active,
  counts,
}: {
  active: LocksTab;
  /** Optional small count shown after a tab label. */
  counts?: Partial<Record<LocksTab, number>>;
}) {
  return (
    <nav aria-label="Locks sections" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-4">
        {LOCKS_TABS.map((tab) => {
          const isActive = tab.id === active;
          const count = counts?.[tab.id];
          return (
            <li key={tab.id}>
              <Link
                href={`/locks?tab=${tab.id}`}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm ${
                  isActive
                    ? "border-ink font-semibold text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {tab.label}
                {count !== undefined && (
                  <span className="rounded-full bg-surface-muted px-1.5 text-[10px] text-ink-muted">
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
