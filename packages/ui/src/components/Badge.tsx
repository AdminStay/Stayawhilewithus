import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "../lib/cx";
import { TONE_BADGE_CLASSES, type Tone } from "../lib/tones";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: Tone;
}

export function Badge({
  children,
  tone = "neutral",
  className,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-medium",
        TONE_BADGE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
