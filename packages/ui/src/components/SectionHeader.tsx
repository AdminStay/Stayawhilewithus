import type { ReactNode } from "react";

import { cx } from "../lib/cx";

export interface SectionHeaderProps {
  title: string;
  /** Optional supporting line — only meaningful at size="lg". */
  description?: string;
  /**
   * "sm" (default) is the quiet, uppercase label used for secondary/
   * reference sections. "lg" is a real heading, for the one or two
   * sections on a page that deserve primary visual weight.
   */
  size?: "sm" | "lg";
  action?: ReactNode;
  className?: string;
}

/** Labels a section of a page. Establishes hierarchy via type size/weight, not a border or background. */
export function SectionHeader({
  title,
  description,
  size = "sm",
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cx("mb-3 flex items-start justify-between gap-4", className)}
    >
      <div>
        <h2
          className={
            size === "lg"
              ? "font-display text-lg font-semibold text-ink"
              : "text-xs font-semibold uppercase tracking-wide text-ink-muted"
          }
        >
          {title}
        </h2>
        {description && size === "lg" && (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
