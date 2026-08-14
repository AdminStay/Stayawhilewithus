import { cx } from "../lib/cx";
import { TONE_DOT_CLASSES, type Tone } from "../lib/tones";

export interface StatusIndicatorProps {
  label: string;
  tone?: Tone;
  className?: string;
}

/** A small dot + label, for inline status where a full Badge pill is too heavy (e.g. dense table rows). */
export function StatusIndicator({
  label,
  tone = "neutral",
  className,
}: StatusIndicatorProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-sm text-ink",
        className,
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          TONE_DOT_CLASSES[tone],
        )}
      />
      {label}
    </span>
  );
}
