import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { cx } from "../lib/cx";

export interface MetricStripProps {
  children: ReactNode;
  className?: string;
  /**
   * How many columns at the xl breakpoint (match your actual metric count).
   * A fixed lookup table, not an arbitrary class string — two conflicting
   * `xl:grid-cols-N` utilities in the same output would silently pick
   * whichever Tailwind happens to generate later, not whichever is passed
   * last, so this only ever emits one.
   */
  xlColumns?: 3 | 4 | 5 | 6;
}

const XL_COLUMN_CLASSES: Record<
  NonNullable<MetricStripProps["xlColumns"]>,
  string
> = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
};

/**
 * One elevated surface holding several metrics, separated by hairlines
 * rather than each metric being its own bordered/shadowed card — the
 * difference between "a hero metrics band" and "six identical boxes."
 *
 * Dividers are done via a 1px `gap` over a `bg-border` container (each
 * Metric cell paints its own `bg-surface`) rather than `divide-x`/
 * `divide-y` — Tailwind's divide utilities key off DOM order ("every
 * child but the first"), which draws a spurious line between columns in
 * the same visual row once the grid wraps to multiple rows. The gap trick
 * is the one that's actually correct at every column count.
 */
export function MetricStrip({
  children,
  className,
  xlColumns = 6,
}: MetricStripProps) {
  return (
    <div
      className={cx(
        "grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border shadow-card sm:grid-cols-3",
        XL_COLUMN_CLASSES[xlColumns],
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MetricProps {
  label: string;
  value: string | number;
  href?: string;
  icon?: ComponentType<{ className?: string }>;
  hint?: ReactNode;
}

export function Metric({ label, value, href, icon: Icon, hint }: MetricProps) {
  const content = (
    <div className="bg-surface p-4 transition-colors hover:bg-ivory-200/40 sm:p-5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 font-display text-[1.65rem] font-semibold leading-none text-ink">
        {value}
      </div>
      {hint && (
        <div className="mt-1.5 truncate text-xs text-ink-faint">{hint}</div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}
