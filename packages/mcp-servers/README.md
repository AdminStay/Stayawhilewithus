# @stayw/mcp-servers

Structural scaffold for the platform's MCP (Model Context Protocol) servers. `src/shared/bootstrap.ts` provides `createMcpServer()`, the common entry point every server wraps.

## Adding a new MCP server

1. Create `src/<name>/index.ts`, call `createMcpServer({ name, version })`, register tools/resources.
2. Add a `bin/<name>.ts` entry point if it needs to run standalone (stdio transport).
3. Document the server's purpose and available tools in `src/<name>/README.md`.

No servers are implemented yet — this phase only scaffolds the shared bootstrap. Individual MCP servers are added as AI & Automation phase needs emerge.
