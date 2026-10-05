"use client";

import { Button } from "@stayw/ui";
import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies a prepared cleaner message to the clipboard (Cleaner Phase 5.1).
 * The admin then sends it themselves (e.g. from Google Voice). This
 * component only writes to the local clipboard — it sends nothing, calls
 * no server action, provider or API, and changes no data. If the browser
 * blocks clipboard access, the text is shown so it can be copied by hand.
 */
export function CopyCleanerMessageButton({ message }: { message: string }) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="secondary" size="sm" onClick={copy}>
        {state === "copied" ? "Copied ✓" : "Copy cleaner message"}
      </Button>
      {state === "failed" && (
        <div className="space-y-1">
          <p role="status" className="text-xs text-error-500">
            Couldn&apos;t copy automatically — select and copy the text below.
          </p>
          <pre className="whitespace-pre-wrap rounded border border-border bg-surface-muted p-2 text-xs text-ink">
            {message}
          </pre>
        </div>
      )}
    </div>
  );
}
