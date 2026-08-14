import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { cx } from "../lib/cx";

export interface StatCardProps {
  label: string;
  value: string | number;
  href?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Small supporting line under the value, e.g. "3 of 12 properties occupied". */
  hint?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  href,
  icon: Icon,
  hint,
  className,
}: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        {Icon && (
          <span className="rounded-lg bg-surface-muted p-1.5 text-forest-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-3 font-display text-3xl font-semibold text-ink">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </>
  );

  const classes = cx(
    "block rounded-card border border-border bg-surface p-5 shadow-card",
    href && "transition-shadow duration-150 hover:shadow-card-hover",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }

  return <div className={classes}>{body}</div>;
}
