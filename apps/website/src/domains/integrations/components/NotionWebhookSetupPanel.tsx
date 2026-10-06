"use client";

import { Button } from "@stayw/ui";
import { useState } from "react";

import type {
  NotionWebhookSetupStatus,
  RevealResult,
} from "../services/notion-webhook-setup.service";

/**
 * Admin-only Notion webhook setup helper (2026-09-30). Shows whether the
 * signing secret is configured and whether a verification token was
 * captured (fingerprint + time only). "Reveal token" fetches it once for
 * copying into Notion's Verify box and Vercel; "Clear" removes it after
 * setup. The token is never rendered until the admin asks for it.
 */
export function NotionWebhookSetupPanel({
  status,
  revealAction,
  clearAction,
}: {
  status: NotionWebhookSetupStatus;
  revealAction: () => Promise<RevealResult | { status: "error" }>;
  clearAction: () => Promise<{ status: "cleared" | "none" | "error" }>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    const result = await revealAction();
    setBusy(false);
    if (result.status === "revealed") {
      setToken(result.token);
      setMessage(null);
    } else {
      setToken(null);
      setMessage(
        result.status === "none"
          ? "No verification token has been received yet."
          : "The token couldn't be read. Resend it from Notion's Webhooks tab.",
      );
    }
  }

  async function clear() {
    setBusy(true);
    const result = await clearAction();
    setBusy(false);
    setToken(null);
    setMessage(
      result.status === "cleared"
        ? "Setup token cleared."
        : "Nothing to clear.",
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <p className="text-ink">
        Signing secret in Vercel:{" "}
        <strong>
          {status.signingSecretConfigured ? "configured" : "not configured"}
        </strong>
      </p>
      {status.pending ? (
        <p className="text-ink-muted">
          Verification token received{" "}
          {new Date(status.pending.receivedAt).toLocaleString()} (fingerprint{" "}
          <code className="text-xs">{status.pending.fingerprint}</code>)
          {status.pending.revealedAt ? " — already revealed once." : "."}
        </p>
      ) : (
        <p className="text-ink-muted">No verification token captured.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || !status.pending}
          onClick={reveal}
        >
          Reveal token
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || !status.pending}
          onClick={clear}
        >
          Clear setup token
        </Button>
      </div>
      {token && (
        <input
          aria-label="Notion verification token"
          readOnly
          value={token}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-border px-2 py-1 font-mono text-xs"
        />
      )}
      {message && <p className="text-xs text-ink-muted">{message}</p>}
    </div>
  );
}
