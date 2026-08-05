import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface McpServerConfig {
  name: string;
  version: string;
}

/**
 * Common bootstrap for every StayWhile MCP server: consistent naming and
 * version reporting. Each server (added under its own src/<name>/ folder as
 * MCP needs arise) wraps this with its own tool/resource registrations.
 */
export function createMcpServer(config: McpServerConfig): Server {
  return new Server(
    { name: config.name, version: config.version },
    { capabilities: { tools: {}, resources: {} } },
  );
}
