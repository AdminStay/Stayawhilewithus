export interface MemoryMessage {
  role: string;
  content: string;
  tokenCount?: number | null;
}

const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_MAX_TOKENS = 8000;

function estimateTokens(message: MemoryMessage): number {
  return (
    message.tokenCount ??
    Math.ceil(message.content.length / CHARS_PER_TOKEN_ESTIMATE)
  );
}

export interface WindowOptions {
  maxTokens?: number;
  maxMessages?: number;
}

/**
 * Short-term conversation memory: keeps the most recent messages that fit a
 * token budget, working backward from the end of history so nothing recent
 * gets dropped in favor of something older. Always keeps at least the
 * single most recent message even if it alone exceeds the budget —
 * truncating it away would leave the turn with nothing to respond to.
 * Uses AiMessage.tokenCount when the caller has it (the real count from a
 * prior API response); falls back to a chars/4 estimate otherwise, which is
 * standard practice pre-tokenization.
 *
 * This is short-term memory only — bounding what goes into one completion
 * call. Long-term/semantic memory (recalling relevant facts from *other*
 * conversations via embeddings) needs a vector store, a separate,
 * credential-gated decision; see ../knowledge/ for that boundary.
 */
export function windowConversationHistory<T extends MemoryMessage>(
  messages: T[],
  options: WindowOptions = {},
): T[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxMessages = options.maxMessages;

  const windowed: T[] = [];
  let totalTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as T;
    const tokens = estimateTokens(message);

    if (windowed.length > 0 && totalTokens + tokens > maxTokens) break;
    if (maxMessages !== undefined && windowed.length >= maxMessages) break;

    windowed.unshift(message);
    totalTokens += tokens;
  }

  return windowed;
}
