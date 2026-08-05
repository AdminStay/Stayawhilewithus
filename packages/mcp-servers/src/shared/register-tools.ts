import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { executeTool } from "@stayw/ai";
import type { ToolDefinition, ToolExecutionContext } from "@stayw/ai";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Maps @stayw/ai's Tool Registry onto an MCP server's tool-call handlers:
 * ListTools reports every given tool's JSON-Schema-converted input shape;
 * CallTool runs it through executeTool(), which itself enforces the
 * requiresApproval gate — this layer never bypasses that check.
 */
export function registerToolsOnServer(
  server: Server,
  tools: readonly ToolDefinition[],
  contextFor: (extra: unknown) => ToolExecutionContext = () => ({}),
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema, {
        target: "jsonSchema7",
      }) as Record<string, unknown> & { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: "${request.params.name}".`);
    }

    const result = await executeTool(
      tool.name,
      request.params.arguments ?? {},
      contextFor(extra),
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  });
}
