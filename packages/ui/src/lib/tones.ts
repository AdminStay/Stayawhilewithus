/** Shared semantic tone system used by Badge and StatusIndicator so status colors stay consistent everywhere they appear. */
export type Tone =
  "neutral" | "success" | "warning" | "error" | "info" | "gold";

export const TONE_BADGE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  error: "bg-error-50 text-error-600",
  info: "bg-info-50 text-info-600",
  gold: "bg-gold-50 text-gold-600",
};

export const TONE_DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  success: "bg-success-500",
  warning: "bg-warning-500",
  error: "bg-error-500",
  info: "bg-info-500",
  gold: "bg-gold-500",
};
