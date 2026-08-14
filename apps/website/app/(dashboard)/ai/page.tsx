import { PageHeader } from "@stayw/ui";

import { ConversationList } from "@/domains/ai/components/ConversationList";
import { ConversationView } from "@/domains/ai/components/ConversationView";
import { PendingActionsList } from "@/domains/ai/components/PendingActionsList";
import { RecentActionsList } from "@/domains/ai/components/RecentActionsList";
import {
  getAiConversation,
  listAiConversations,
  listPendingAiActions,
  listRecentAiActions,
} from "@/domains/ai/services/ai.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  const actor = await getCurrentUser();
  const { conversationId } = await searchParams;

  const [conversations, pendingActions, recentActions, activeConversation] =
    await Promise.all([
      listAiConversations(actor),
      listPendingAiActions(actor),
      listRecentAiActions(actor),
      conversationId ? getAiConversation(actor, conversationId) : null,
    ]);

  return (
    <div>
      <PageHeader
        title="AI Assistant"
        subtitle="Ask the ops assistant about your properties, reservations, and tasks."
      />
      <div className="flex gap-6">
        <ConversationList
          conversations={conversations}
          activeConversationId={conversationId}
        />
        <ConversationView conversation={activeConversation} />
      </div>
      <PendingActionsList actions={pendingActions} />
      <RecentActionsList actions={recentActions} />
    </div>
  );
}
