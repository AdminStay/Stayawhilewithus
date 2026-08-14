"use client";

import { Badge, Button, Input } from "@stayw/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

type StreamedToolCall = {
  name: string;
  status: "executed" | "pending_approval";
  output?: unknown;
  actionId?: string;
};

/**
 * Client-side replacement for the plain `<form action={sendAiMessageAction}>`
 * — same underlying operation (still calls sendAiMessage server-side, still
 * runs the full orchestrator turn including tool-use and the approval gate),
 * but posts to the streaming route (app/api/ai/messages/route.ts) and
 * renders the turn's tool_call events and reply as they arrive instead of
 * blocking on the whole request. See that route's comment for exactly what
 * "streaming" means here — these are real events from the completed turn,
 * sequenced for delivery, not live generation.
 */
export function ChatComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [streamedToolCalls, setStreamedToolCalls] = useState<
    StreamedToolCall[]
  >([]);
  const [streamedText, setStreamedText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || isStreaming) return;

    const message = draft;
    setDraft("");
    setStreamedToolCalls([]);
    setStreamedText("");
    setIsStreaming(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Assistant request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let nextConversationId = conversationId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const eventLine = raw
            .split("\n")
            .find((l) => l.startsWith("event: "));
          const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.slice("event: ".length);
          const data = JSON.parse(dataLine.slice("data: ".length));

          if (eventName === "tool_call") {
            setStreamedToolCalls((prev) => [...prev, data as StreamedToolCall]);
          } else if (eventName === "chunk") {
            setStreamedText((prev) => prev + data.text);
          } else if (eventName === "done") {
            nextConversationId = data.conversationId;
          }
        }
      }

      router.push(`/ai?conversationId=${nextConversationId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsStreaming(false);
      setStreamedToolCalls([]);
      setStreamedText("");
    }
  }

  return (
    <div>
      {isStreaming && (
        <div className="mb-3 rounded-lg border border-forest-100 bg-forest-50 p-3 text-sm">
          <span className="font-medium text-forest-900">Assistant</span>
          {streamedToolCalls.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {streamedToolCalls.map((call, i) => (
                <li
                  key={`${call.name}-${i}`}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink-muted"
                >
                  <span className="font-mono font-medium text-ink">
                    {call.name}
                  </span>{" "}
                  <Badge
                    tone={
                      call.status === "pending_approval" ? "gold" : "success"
                    }
                  >
                    {call.status === "pending_approval"
                      ? "awaiting approval"
                      : "executed"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {streamedText ? (
            <p className="mt-1.5 whitespace-pre-wrap text-ink">
              {streamedText}
            </p>
          ) : (
            <p className="mt-1.5 text-ink-faint">
              {streamedToolCalls.length > 0 ? "…" : "Thinking…"}
            </p>
          )}
        </div>
      )}
      {error && <p className="mb-3 text-sm text-error-500">{error}</p>}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          name="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          required
          disabled={isStreaming}
          placeholder="Ask the ops assistant..."
          className="flex-1"
        />
        <Button type="submit" disabled={isStreaming}>
          {isStreaming ? "Sending…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
