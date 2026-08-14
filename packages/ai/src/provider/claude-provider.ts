import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { createLogger } from "../logging/logger";

import { registerModelProviderFactory } from "./registry";
import type {
  CompletionInput,
  CompletionResult,
  ModelContentBlock,
  ModelMessage,
  ModelProvider,
  StopReason,
  StreamEvent,
} from "./types";

export interface ClaudeProviderOptions {
  apiKey: string;
  model?: string;
  /** Defaults to 4096 — generous enough for a real ops-assistant reply without being unbounded. Override per-instance, or via ANTHROPIC_MAX_TOKENS at the factory level. */
  maxTokens?: number;
}

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 4096;

const logger = createLogger("provider.claude");

function toAnthropicContent(
  content: ModelMessage["content"],
): string | Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;

  return content.map((block): Anthropic.ContentBlockParam => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError,
        };
    }
  });
}

function fromAnthropicStopReason(stopReason: string | null): StopReason {
  switch (stopReason) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "stop_sequence":
      return stopReason;
    default:
      return "unknown";
  }
}

function fromAnthropicContent(
  content: Anthropic.ContentBlock[],
): ModelContentBlock[] {
  return content.flatMap((block): ModelContentBlock[] => {
    if (block.type === "text") {
      return [{ type: "text", text: block.text }];
    }
    if (block.type === "tool_use") {
      return [
        {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        },
      ];
    }
    // Other block types (e.g. thinking/redacted_thinking) aren't part of
    // this platform's content model yet — dropped rather than erroring, same
    // "degrade, don't block" stance as Context Builder's assembleContext().
    return [];
  });
}

/**
 * The Claude Provider Adapter — the one place Anthropic's specific
 * request/response shape gets translated to/from the provider-agnostic
 * ModelProvider contract (../types.ts). Only ever constructed by
 * createModelProvider() when ANTHROPIC_API_KEY is present;
 * NotConfiguredModelProvider remains the default otherwise. A future
 * OpenAiProviderAdapter/GeminiProviderAdapter would live alongside this
 * file implementing the same ModelProvider interface — nothing elsewhere
 * in the platform would need to change.
 */
export class ClaudeProviderAdapter implements ModelProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    logger.debug("completion requested", {
      model: this.model,
      messageCount: input.messages.length,
      toolCount: input.tools?.length ?? 0,
    });

    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: input.system,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: toAnthropicContent(message.content),
        })),
        tools: input.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        })),
      });
    } catch (err) {
      logger.error("completion request failed", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    logger.debug("completion received", {
      stopReason: response.stop_reason,
      blockCount: response.content.length,
    });

    return {
      content: fromAnthropicContent(response.content),
      stopReason: fromAnthropicStopReason(response.stop_reason),
    };
  }

  async *completeStream(input: CompletionInput): AsyncIterable<StreamEvent> {
    logger.debug("stream requested", { model: this.model });

    let stream;
    try {
      stream = this.client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        system: input.system,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: toAnthropicContent(message.content),
        })),
        tools: input.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        })),
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text_delta", text: event.delta.text };
        }
      }
    } catch (err) {
      logger.error("stream request failed", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    logger.debug("stream complete");
    yield { type: "message_stop" };
  }
}

function parseMaxTokens(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Self-registration: this is the only place ANTHROPIC_API_KEY/ANTHROPIC_MODEL/
 * ANTHROPIC_MAX_TOKENS get read anywhere in the package.
 * createModelProvider() (./create-provider.ts) never references
 * ClaudeProviderAdapter by name — it only knows "claude" as a registered
 * factory name, exactly like any other vendor would be.
 */
registerModelProviderFactory({
  name: "claude",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  create: () =>
    new ClaudeProviderAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      model: process.env.ANTHROPIC_MODEL,
      maxTokens: parseMaxTokens(process.env.ANTHROPIC_MAX_TOKENS),
    }),
});
