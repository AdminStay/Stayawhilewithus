import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "../lib/cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Removes the default padding, for cards that manage their own inner spacing (e.g. Table). */
  noPadding?: boolean;
  /** Lifts on hover — use for cards that are also links/buttons. */
  interactive?: boolean;
}

export function Card({
  children,
  noPadding,
  interactive,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        "rounded-card border border-border bg-surface shadow-card",
        !noPadding && "p-6",
        interactive && "transition-shadow duration-150 hover:shadow-card-hover",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
