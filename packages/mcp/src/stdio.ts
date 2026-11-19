// Local alternative: run over stdio (e.g. for Claude Desktop / MCP Inspector).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcpServer.js';
await createMcpServer().connect(new StdioServerTransport());
