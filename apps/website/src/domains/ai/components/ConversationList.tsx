import { Button, Card, cx } from "@stayw/ui";
import { Plus } from "lucide-react";
import Link from "next/link";

import type { AiConversation } from "../services/ai.service";

type ConversationWithPreview = AiConversation & {
  messages: { content: string }[];
};

export function ConversationList({
  conversations,
  activeConversationId,
}: {
  conversations: ConversationWithPreview[];
  activeConversationId?: string;
}) {
  return (
    <Card noPadding className="w-64 shrink-0">
      <div className="border-b border-border p-3">
        <Link href="/ai">
          <Button variant="secondary" size="sm" className="w-full">
            <Plus className="h-3.5 w-3.5" />
            New conversation
          </Button>
        </Link>
      </div>
      <ul className="scrollbar-thin max-h-[32rem] overflow-y-auto p-2">
        {conversations.length === 0 && (
          <li className="px-3 py-2 text-sm text-ink-muted">
            No conversations yet.
          </li>
        )}
        {conversations.map((c) => (
          <li key={c.id}>
            <Link
              href={`/ai?conversationId=${c.id}`}
              className={cx(
                "block truncate rounded-lg px-3 py-2 text-sm transition-colors",
                c.id === activeConversationId
                  ? "bg-forest-50 font-medium text-forest-700"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {c.subject || c.messages[0]?.content || "(empty)"}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
