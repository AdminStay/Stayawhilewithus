import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@stayw/ai", () => ({
  executeTool: vi.fn(),
}));

import { executeTool } from "@stayw/ai";
import type { ToolDefinition } from "@stayw/ai";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { registerToolsOnServer } from "./register-tools";

type Handler = (request: unknown, extra: unknown) => Promise<unknown>;

function createMockServer() {
  const handlers = new Map<unknown, Handler>();
  const server = {
    setRequestHandler: vi.fn((schema: unknown, handler: Handler) => {
      handlers.set(schema, handler);
    }),
  } as unknown as Server;
  return { server, handlers };
}

const echoTool: ToolDefinition = {
  name: "test.echo",
  description: "Echoes input",
  inputSchema: z.object({ text: z.string() }),
  requiresApproval: false,
  handler: async (input) => ({ echoed: (input as { text: string }).text }),
};

describe("registerToolsOnServer", () => {
  it("reports every tool's JSON-Schema input shape via ListTools", async () => {
    const { server, handlers } = createMockServer();
    registerToolsOnServer(server, [echoTool]);

    const listHandler = handlers.get(ListToolsRequestSchema);
    const result = (await listHandler?.({}, {})) as {
      tools: Array<{ name: string; inputSchema: { type: string } }>;
    };

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      name: "test.echo",
      description: "Echoes input",
    });
    expect(result.tools[0]?.inputSchema.type).toBe("object");
  });

  it("runs the matching tool through executeTool on CallTool", async () => {
    vi.mocked(executeTool).mockResolvedValue({
      status: "executed",
      output: { echoed: "hi" },
    });
    const { server, handlers } = createMockServer();
    registerToolsOnServer(server, [echoTool]);

    const callHandler = handlers.get(CallToolRequestSchema);
    const response = (await callHandler?.(
      { params: { name: "test.echo", arguments: { text: "hi" } } },
      {},
    )) as { content: Array<{ type: string; text: string }> };

    expect(executeTool).toHaveBeenCalledWith("test.echo", { text: "hi" }, {});
    expect(JSON.parse(response.content[0]?.text ?? "null")).toEqual({
      status: "executed",
      output: { echoed: "hi" },
    });
  });

  it("throws for an unknown tool name instead of calling executeTool", async () => {
    const { server, handlers } = createMockServer();
    registerToolsOnServer(server, [echoTool]);

    const callHandler = handlers.get(CallToolRequestSchema);

    await expect(
      callHandler?.(
        { params: { name: "test.nonexistent", arguments: {} } },
        {},
      ),
    ).rejects.toThrow(/Unknown tool/);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("derives the tool-execution context from the request's extra via contextFor", async () => {
    vi.mocked(executeTool).mockResolvedValue({
      status: "executed",
      output: null,
    });
    const { server, handlers } = createMockServer();
    registerToolsOnServer(server, [echoTool], (extra) => ({
      userId: (extra as { userId: string }).userId,
    }));

    const callHandler = handlers.get(CallToolRequestSchema);
    await callHandler?.(
      { params: { name: "test.echo", arguments: { text: "hi" } } },
      { userId: "user-1" },
    );

    expect(executeTool).toHaveBeenCalledWith(
      "test.echo",
      { text: "hi" },
      { userId: "user-1" },
    );
  });
});
