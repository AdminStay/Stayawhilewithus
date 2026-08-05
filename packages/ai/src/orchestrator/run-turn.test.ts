import { describe, expect, it, vi } from "vitest";

vi.mock("../context/registry", () => ({
  assembleContext: vi.fn(async () => [{ source: "test", content: "ctx" }]),
}));
vi.mock("../conversations/repository", () => ({
  appendMessage: vi.fn(async () => ({ id: "m1" })),
  getConversationHistory: vi.fn(async () => [
    { role: "USER", content: "Where's the wifi password?" },
  ]),
}));
vi.mock("../prompts/registry", () => ({
  renderPrompt: vi.fn(() => "You are the StayWhile assistant. Context: ctx"),
}));

import { assembleContext } from "../context/registry";
import { appendMessage } from "../conversations/repository";
import { renderPrompt } from "../prompts/registry";

import { runOrchestratorTurn } from "./run-turn";

describe("runOrchestratorTurn", () => {
  it("assembles context, renders the prompt, and persists both turns with a real claude client", async () => {
    const claudeClient = {
      complete: vi.fn(async () => "The wifi password is on the fridge."),
    };

    const result = await runOrchestratorTurn(
      {
        conversationId: "c1",
        userMessage: "Where's the wifi password?",
        promptKey: "guest-support.system",
      },
      claudeClient,
    );

    expect(assembleContext).toHaveBeenCalled();
    expect(renderPrompt).toHaveBeenCalledWith(
      "guest-support.system",
      expect.objectContaining({ context: "ctx" }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c1", role: "USER" }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c1", role: "ASSISTANT" }),
    );
    expect(claudeClient.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are the StayWhile assistant. Context: ctx",
      }),
    );
    expect(result.assistantMessage).toBe("The wifi password is on the fridge.");
  });

  it("throws NotImplementedError when no real claude client is supplied", async () => {
    await expect(
      runOrchestratorTurn({
        conversationId: "c1",
        userMessage: "Where's the wifi password?",
        promptKey: "guest-support.system",
      }),
    ).rejects.toThrow(/not implemented yet/);
  });
});
