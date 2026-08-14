import {
  Button,
  Card,
  EmptyState,
  Input,
  StatusIndicator,
  cx,
  type Tone,
} from "@stayw/ui";
import { MessageSquare } from "lucide-react";

import {
  archiveMessageThreadAction,
  closeMessageThreadAction,
  sendMessageAction,
} from "../actions";

import type {
  Message,
  MessageThread,
} from "../services/communications.service";

type ThreadWithRelations = MessageThread & {
  property: { name: string } | null;
  guest: { firstName: string; lastName: string } | null;
  messages: Message[];
};

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "success",
  CLOSED: "neutral",
  ARCHIVED: "neutral",
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

export function MessageThreadList({
  threads,
}: {
  threads: ThreadWithRelations[];
}) {
  if (threads.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={MessageSquare}
          title="No message threads yet"
          description="Start a new thread to get started."
        />
      </Card>
    );
  }

  return (
    <div className="divide-y divide-border rounded-card border border-border bg-surface shadow-card">
      {threads.map((thread) => (
        <div key={thread.id} className="p-5">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <span className="font-medium text-ink">
                {thread.subject || "(no subject)"}
              </span>
              <span className="ml-2 text-sm text-ink-muted">
                {thread.property?.name}
                {thread.guest &&
                  ` — ${thread.guest.firstName} ${thread.guest.lastName}`}
              </span>
            </div>
            <StatusIndicator
              label={thread.status}
              tone={STATUS_TONE[thread.status] ?? "neutral"}
            />
          </div>

          <ul className="mt-3 space-y-2">
            {thread.messages.map((m) => (
              <li
                key={m.id}
                className={cx(
                  "max-w-lg rounded-lg px-3 py-2 text-sm",
                  m.direction === "INBOUND"
                    ? "bg-surface-muted text-ink"
                    : "ml-auto bg-forest-50 text-forest-900",
                )}
              >
                <p>{m.body}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {formatDate(m.sentAt)}
                </p>
              </li>
            ))}
          </ul>

          {thread.status === "OPEN" && (
            <form action={sendMessageAction} className="mt-4 flex gap-2">
              <input type="hidden" name="threadId" value={thread.id} />
              <Input
                name="body"
                required
                placeholder="Reply..."
                className="flex-1"
              />
              <Button type="submit">Send</Button>
            </form>
          )}
          <div className="mt-3 flex justify-end">
            {thread.status === "OPEN" && (
              <form action={closeMessageThreadAction}>
                <input type="hidden" name="threadId" value={thread.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Close thread
                </Button>
              </form>
            )}
            {thread.status === "CLOSED" && (
              <form action={archiveMessageThreadAction}>
                <input type="hidden" name="threadId" value={thread.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Archive thread
                </Button>
              </form>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
