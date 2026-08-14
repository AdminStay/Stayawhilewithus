import { describe, expect, it, vi } from "vitest";

vi.mock("../conversations/repository", () => ({
  closeConversation: vi.fn(async () => ({ id: "c1", status: "ESCALATED" })),
}));

import { closeConversation } from "../conversations/repository";

import { escalateConversation } from "./escalate";

describe("escalateConversation", () => {
  it("closes the conversation as ESCALATED", async () => {
    const result = await escalateConversation({
      conversationId: "c1",
      reason: "max_tool_iterations",
    });

    expect(closeConversation).toHaveBeenCalledWith("c1", "ESCALATED");
    expect(result).toEqual({ id: "c1", status: "ESCALATED" });
  });
});
