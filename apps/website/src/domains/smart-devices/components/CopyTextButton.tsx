"use client";

import { Button } from "@stayw/ui";
import { useState } from "react";

/**
 * Copies prepared plain text to the clipboard (2026-09-29, daily lock
 * report). Purely client-side: no request, no write — the text was already
 * rendered by the server page.
 */
export function CopyTextButton({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
        {label}
      </Button>
      {state === "copied" && (
        <span className="text-xs text-success-600">Copied.</span>
      )}
      {state === "failed" && (
        <span className="text-xs text-error-500">
          Couldn&apos;t copy — try selecting the report instead.
        </span>
      )}
    </div>
  );
}
