import {
  describeAugustTokenExpiry,
  type AugustTokenExpiry,
} from "../lib/august-token-expiry";

const TONE_CLASS = {
  neutral: "text-ink-muted",
  warning: "font-medium text-warning-700",
  error: "font-medium text-error-500",
} as const;

/**
 * August login expiry line (2026-10-21).
 * - "card" (/integrations August card): every state, including "not
 *   configured" and the quiet "expires on …" line.
 * - "banner" (/locks): only when action is needed — expiring soon or
 *   expired — so the page isn't cluttered otherwise.
 * - showRenewalSteps: global admins only. Others see the same dates and
 *   urgency with "an admin needs to renew it" and no setting names.
 */
export function AugustTokenExpiryNotice({
  status,
  variant,
  showRenewalSteps,
  className = "",
}: {
  status: AugustTokenExpiry;
  variant: "card" | "banner";
  /** True only for global admins (isGlobalAdmin). */
  showRenewalSteps: boolean;
  className?: string;
}) {
  if (
    variant === "banner" &&
    status.state !== "expiring_soon" &&
    status.state !== "expired"
  ) {
    return null;
  }
  const { tone, text } = describeAugustTokenExpiry(status, {
    showRenewalSteps,
  });
  return (
    <p
      role={tone === "neutral" ? undefined : "alert"}
      data-august-token-expiry={status.state}
      className={`text-xs ${TONE_CLASS[tone]} ${className}`.trim()}
    >
      {text}
    </p>
  );
}
