import { afterEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
  },
}));

import { resetLogSink, setLogSink } from "../logging/logger";

import { ClaudeProviderAdapter } from "./claude-provider";

afterEach(() => {
  resetLogSink();
});

describe("ClaudeProviderAdapter.complete", () => {
  it("calls the Anthropic Messages API and maps text content + stop_reason", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "The wifi password is on the fridge." }],
      stop_reason: "end_turn",
    });

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });
    const result = await provider.complete({
      system: "You are the StayWhile assistant.",
      messages: [{ role: "user", content: "Where's the wifi password?" }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        system: "You are the StayWhile assistant.",
        messages: [{ role: "user", content: "Where's the wifi password?" }],
      }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "The wifi password is on the fridge." }],
      stopReason: "end_turn",
    });
  });

  it("uses a custom model when provided", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new ClaudeProviderAdapter({
      apiKey: "sk-ant-test",
      model: "claude-opus-5",
    });
    await provider.complete({ system: "sys", messages: [] });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-5" }),
    );
  });

  it("maps tool_use blocks and a tool_use stop_reason", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "tool_use", id: "t1", name: "properties.list", input: {} },
      ],
      stop_reason: "tool_use",
    });

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });
    const result = await provider.complete({
      system: "sys",
      messages: [],
      tools: [
        {
          name: "properties.list",
          description: "Lists properties",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: "properties.list",
            input_schema: { type: "object", properties: {} },
          }),
        ],
      }),
    );
    expect(result).toEqual({
      content: [
        { type: "tool_use", id: "t1", name: "properties.list", input: {} },
      ],
      stopReason: "tool_use",
    });
  });

  it("sends tool_result content blocks through to the API", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });
    await provider.complete({
      system: "sys",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolUseId: "t1",
              content: "[]",
            },
          ],
        },
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: "[]",
                is_error: undefined,
              },
            ],
          },
        ],
      }),
    );
  });

  it('maps an unrecognized stop_reason to "unknown" rather than throwing', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "something_new",
    });

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });
    const result = await provider.complete({ system: "sys", messages: [] });

    expect(result.stopReason).toBe("unknown");
  });

  it("defaults max_tokens to 4096", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });
    await provider.complete({ system: "sys", messages: [] });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 }),
    );
  });

  it("uses a custom maxTokens when provided", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new ClaudeProviderAdapter({
      apiKey: "sk-ant-test",
      maxTokens: 200,
    });
    await provider.complete({ system: "sys", messages: [] });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 200 }),
    );
  });

  it("logs and rethrows when the API call fails, rather than swallowing the error", async () => {
    const entries: unknown[] = [];
    setLogSink((entry) => entries.push(entry));
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { status: 429 }),
    );

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });

    await expect(
      provider.complete({ system: "sys", messages: [] }),
    ).rejects.toThrow("rate limited");
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "completion request failed",
          error: "rate limited",
        }),
      ]),
    );
  });
});

describe("ClaudeProviderAdapter.completeStream", () => {
  it("yields text_delta events from content_block_delta and a final message_stop", async () => {
    mockStream.mockReturnValueOnce([
      { type: "message_start" },
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " world" },
      },
      { type: "message_stop" },
    ]);

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });
    const events = [];
    for await (const event of provider.completeStream({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "message_stop" },
    ]);
  });

  it("ignores non-text-delta events", async () => {
    mockStream.mockReturnValueOnce([
      { type: "content_block_start" },
      {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{}" },
      },
    ]);

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });
    const events = [];
    for await (const event of provider.completeStream({
      system: "sys",
      messages: [],
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "message_stop" }]);
  });

  it("logs and rethrows when the stream call fails, rather than swallowing the error", async () => {
    const entries: unknown[] = [];
    setLogSink((entry) => entries.push(entry));
    mockStream.mockImplementationOnce(() => {
      throw new Error("connection reset");
    });

    const provider = new ClaudeProviderAdapter({ apiKey: "sk-ant-test" });

    await expect(async () => {
      for await (const _event of provider.completeStream({
        system: "sys",
        messages: [],
      })) {
        // draining the generator to trigger the throw
      }
    }).rejects.toThrow("connection reset");
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "stream request failed",
          error: "connection reset",
        }),
      ]),
    );
  });
});
