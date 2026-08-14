import { describe, expect, it } from "vitest";

import { windowConversationHistory } from "./window";

describe("windowConversationHistory", () => {
  it("returns all messages when they fit within the token budget", () => {
    const messages = [
      { role: "USER", content: "hi", tokenCount: 5 },
      { role: "ASSISTANT", content: "hello", tokenCount: 5 },
    ];

    const result = windowConversationHistory(messages, { maxTokens: 100 });

    expect(result).toEqual(messages);
  });

  it("drops the oldest messages first when the budget is exceeded", () => {
    const messages = [
      { role: "USER", content: "old message", tokenCount: 50 },
      { role: "ASSISTANT", content: "old reply", tokenCount: 50 },
      { role: "USER", content: "recent message", tokenCount: 50 },
      { role: "ASSISTANT", content: "recent reply", tokenCount: 50 },
    ];

    const result = windowConversationHistory(messages, { maxTokens: 120 });

    expect(result).toEqual([
      { role: "USER", content: "recent message", tokenCount: 50 },
      { role: "ASSISTANT", content: "recent reply", tokenCount: 50 },
    ]);
  });

  it("always keeps at least the single most recent message, even over budget", () => {
    const messages = [
      { role: "USER", content: "a", tokenCount: 5 },
      { role: "ASSISTANT", content: "b", tokenCount: 9000 },
    ];

    const result = windowConversationHistory(messages, { maxTokens: 100 });

    expect(result).toEqual([
      { role: "ASSISTANT", content: "b", tokenCount: 9000 },
    ]);
  });

  it("estimates tokens from content length when tokenCount is missing", () => {
    const messages = [
      { role: "USER", content: "a".repeat(400) }, // ~100 estimated tokens
      { role: "ASSISTANT", content: "b".repeat(4) }, // ~1 estimated token
    ];

    const result = windowConversationHistory(messages, { maxTokens: 50 });

    // The 100-token-estimated message alone exceeds the budget, so once the
    // most recent (last) message is kept, the older one is dropped.
    expect(result).toEqual([{ role: "ASSISTANT", content: "bbbb" }]);
  });

  it("respects maxMessages as an additional cap", () => {
    const messages = [
      { role: "USER", content: "1", tokenCount: 1 },
      { role: "ASSISTANT", content: "2", tokenCount: 1 },
      { role: "USER", content: "3", tokenCount: 1 },
    ];

    const result = windowConversationHistory(messages, {
      maxTokens: 1000,
      maxMessages: 2,
    });

    expect(result).toEqual([
      { role: "ASSISTANT", content: "2", tokenCount: 1 },
      { role: "USER", content: "3", tokenCount: 1 },
    ]);
  });

  it("returns an empty array for empty history", () => {
    expect(windowConversationHistory([])).toEqual([]);
  });
});
