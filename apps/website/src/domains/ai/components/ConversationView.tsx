import { Badge, Button, Card, Input, cx } from "@stayw/ui";
import { Bot } from "lucide-react";

import { escalateAiConversationAction } from "../actions";

import { ChatComposer } from "./ChatComposer";

import type { AiConversation } from "../services/ai.service";

type ToolCallRecord = {
  name: string;
  input: unknown;
  status: "executed" | "pending_approval";
  output?: unknown;
  actionId?: string;
};

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  /** Prisma's Json? column — typed loosely here and narrowed by extractToolCalls() rather than assuming the shape @stayw/ai's orchestrator happens to write today. */
  toolCalls?: unknown;
};

type ConversationWithMessages = AiConversation & { messages: Message[] };

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

function extractToolCalls(raw: unknown): ToolCallRecord[] {
  if (
    raw &&
    typeof raw === "object" &&
    "calls" in raw &&
    Array.isArray((raw as { calls: unknown }).calls)
  ) {
    return (raw as { calls: ToolCallRecord[] }).calls;
  }
  return [];
}

/** Renders one turn's tool_use history under its assistant message — see @stayw/ai's orchestrator.ts, which persists `{ calls: OrchestratorToolCallRecord[] }` onto the ASSISTANT message row. */
function ToolCallHistory({ calls }: { calls: ToolCallRecord[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {calls.map((call, i) => (
        <li
          key={`${call.name}-${i}`}
          className="rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-xs text-ink-muted"
        >
          <span className="font-mono font-medium text-ink">{call.name}</span>{" "}
          <Badge tone={call.status === "pending_approval" ? "gold" : "success"}>
            {call.status === "pending_approval"
              ? "awaiting approval"
              : "executed"}
          </Badge>
          {call.status === "executed" && call.output !== undefined && (
            <pre className="mt-1.5 whitespace-pre-wrap text-ink-faint">
              {JSON.stringify(call.output, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ConversationView({
  conversation,
}: {
  conversation: ConversationWithMessages | null;
}) {
  const isActive = !conversation || conversation.status === "ACTIVE";

  return (
    <Card noPadding className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h1 className="font-display text-lg font-semibold text-ink">
          Ops Assistant
        </h1>
        {conversation && conversation.status === "ESCALATED" && (
          <Badge tone="gold">Escalated</Badge>
        )}
      </div>

      <ul className="scrollbar-thin max-h-[28rem] flex-1 space-y-4 overflow-y-auto p-5">
        {(!conversation || conversation.messages.length === 0) && (
          <li className="flex flex-col items-center justify-center py-10 text-center text-sm text-ink-muted">
            <Bot className="mb-3 h-6 w-6 text-ink-faint" />
            No messages yet — ask the assistant something below.
          </li>
        )}
        {conversation?.messages.map((m) => (
          <li
            key={m.id}
            className={cx(
              "max-w-lg rounded-lg px-3.5 py-2.5 text-sm",
              m.role === "USER"
                ? "ml-auto bg-forest-50 text-forest-900"
                : "bg-surface-muted text-ink",
              m.role === "SYSTEM" && "italic text-ink-muted",
            )}
          >
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              <span className="font-medium not-italic text-ink-muted">
                {m.role === "USER"
                  ? "You"
                  : m.role === "SYSTEM"
                    ? "System"
                    : "Assistant"}
              </span>
              <span>{formatDate(m.createdAt)}</span>
            </div>
            <p className="mt-1">{m.content}</p>
            {extractToolCalls(m.toolCalls).length > 0 && (
              <ToolCallHistory calls={extractToolCalls(m.toolCalls)} />
            )}
          </li>
        ))}
      </ul>

      {isActive && (
        <div className="border-t border-border p-4">
          <ChatComposer conversationId={conversation?.id ?? ""} />
        </div>
      )}
      {conversation && isActive && (
        <form
          action={escalateAiConversationAction}
          className="flex items-center gap-2 border-t border-border px-4 py-3"
        >
          <input type="hidden" name="conversationId" value={conversation.id} />
          <Input
            name="details"
            placeholder="Why does this need a human? (optional)"
            className="flex-1 py-1.5 text-xs"
          />
          <Button type="submit" variant="ghost" size="sm">
            Escalate to human
          </Button>
        </form>
      )}
    </Card>
  );
}
