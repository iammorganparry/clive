/**
 * MCP Bridge Server
 * IPC server running in the VSCode extension that handles requests from the MCP server
 */

import * as net from "node:net";
import * as fs from "node:fs";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeHandlers,
} from "./types.js";

/**
 * Start the MCP bridge server
 * Creates a Unix socket server that listens for requests from the MCP server
 */
export function startMcpBridgeServer(
  socketPath: string,
  handlers: BridgeHandlers,
): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    // Clean up existing socket file if it exists
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
      // Ignore errors when cleaning up
    }

    const server = net.createServer((socket) => {
      let buffer = "";

      socket.on("data", async (data) => {
        buffer += data.toString();

        // Try to parse complete JSON messages (newline-delimited)
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const request: BridgeRequest = JSON.parse(line);
            const { id, method, params } = request;

            let response: BridgeResponse;

            try {
              const handler = handlers[method];
              if (!handler) {
                response = {
                  id,
                  error: `Unknown method: ${method}`,
                };
              } else {
                const result = await handler(params);
                response = { id, result };
              }
            } catch (error) {
              response = {
                id,
                error:
                  error instanceof Error ? error.message : "Handler failed",
              };
            }

            socket.write(`${JSON.stringify(response)}\n`);
          } catch (parseError) {
            // Skip invalid JSON
            console.error("[MCP Bridge] Invalid JSON:", parseError);
          }
        }
      });

      socket.on("error", (error) => {
        console.error("[MCP Bridge] Socket error:", error);
      });
    });

    server.on("error", (error) => {
      reject(error);
    });

    server.listen(socketPath, () => {
      resolve(server);
    });
  });
}

/**
 * Stop the MCP bridge server and clean up
 */
export async function stopMcpBridgeServer(
  server: net.Server,
  socketPath: string,
): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      // Clean up socket file
      try {
        if (fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      resolve();
    });
  });
}
