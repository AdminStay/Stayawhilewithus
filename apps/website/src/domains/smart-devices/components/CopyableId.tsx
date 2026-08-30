"use client";

import { cx } from "@stayw/ui";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Never alters the underlying stored ID — this only changes what's
 * rendered. Below the threshold (head + tail + a separator), the value is
 * short enough that truncating it wouldn't save meaningful space, so it's
 * returned untouched — real August/Nest external IDs and house-ID UUIDs are
 * comfortably longer than this in practice.
 */
export function truncateId(value: string, head = 8, tail = 5): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Compact display for a long external/house ID: a truncated label, the
 * complete value in the native `title` tooltip, and a small copy-to-
 * clipboard action — never a second network/DB call, purely a client-side
 * render of a value already passed in as a prop.
 */
export function CopyableId({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — this is
      // a convenience action, never worth surfacing as an error state.
    }
  }

  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1 font-mono text-xs text-ink-muted",
        className,
      )}
      title={value}
    >
      <span className="truncate">{truncateId(value)}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${value}`}
        className="shrink-0 text-ink-faint transition-colors hover:text-ink"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}
