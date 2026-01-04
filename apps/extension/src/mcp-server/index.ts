/**
 * Clive MCP Server Entry Point
 * Provides custom tools to Claude CLI via Model Context Protocol
 *
 * This server is spawned by Claude CLI as a subprocess and communicates
 * via stdio transport. For VSCode-dependent operations, it connects to
 * the extension via IPC bridge.
 *
 * Environment Variables:
 * - CLIVE_WORKSPACE: Path to the workspace root
 * - CLIVE_SOCKET: Path to the IPC socket for extension communication
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";

/**
 * Initialize and start the MCP server
 */
async function main(): Promise<void> {
  // Validate required environment variables
  const workspaceRoot = process.env.CLIVE_WORKSPACE;
  if (!workspaceRoot) {
    console.error("[Clive MCP] CLIVE_WORKSPACE environment variable not set");
    process.exit(1);
  }

  const socketPath = process.env.CLIVE_SOCKET;
  if (!socketPath) {
    console.error("[Clive MCP] CLIVE_SOCKET environment variable not set");
    // Don't exit - standalone tools can still work
    console.error("[Clive MCP] Bridge-dependent tools will not be available");
  }

  // Create the MCP server
  const server = new McpServer({
    name: "clive-mcp-server",
    version: "1.0.0",
  });

  // Register all tools
  registerTools(server);

  // Create stdio transport and connect
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[Clive MCP] Server started successfully");
  console.error(`[Clive MCP] Workspace: ${workspaceRoot}`);
  if (socketPath) {
    console.error(`[Clive MCP] Bridge socket: ${socketPath}`);
  }
}

// Start the server
main().catch((error) => {
  console.error("[Clive MCP] Fatal error:", error);
  process.exit(1);
});
