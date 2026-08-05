import { NotImplementedError } from "../errors";

import type { ClaudeClient, ClaudeCompletionInput } from "./types";

/**
 * Real Claude wiring is deferred to a later phase (see ADR-0007). Kept as a
 * stub — not a mock — so runOrchestratorTurn's surrounding plumbing (context
 * assembly, prompt rendering, conversation persistence) is real and
 * exercised today; only the model call itself is unfinished.
 */
export class NotImplementedClaudeClient implements ClaudeClient {
  async complete(_input: ClaudeCompletionInput): Promise<string> {
    throw new NotImplementedError("ClaudeClient", "complete");
  }
}
