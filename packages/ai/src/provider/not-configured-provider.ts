import { NotImplementedError } from "../errors";

import type {
  CompletionInput,
  CompletionResult,
  ModelProvider,
  StreamEvent,
} from "./types";

/**
 * Stands in for any ModelProvider before one is actually configured — kept
 * as a stub, not a mock, so the Orchestrator's surrounding plumbing
 * (context assembly, prompt rendering, the tool-use loop, conversation
 * persistence) is real and exercised today; only the model call itself is
 * unfinished. createModelProvider() picks this when no provider credential
 * is set.
 */
export class NotConfiguredModelProvider implements ModelProvider {
  async complete(_input: CompletionInput): Promise<CompletionResult> {
    throw new NotImplementedError("ModelProvider", "complete");
  }

  completeStream(_input: CompletionInput): AsyncIterable<StreamEvent> {
    throw new NotImplementedError("ModelProvider", "completeStream");
  }
}
