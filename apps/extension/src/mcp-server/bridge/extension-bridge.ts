/**
 * Extension Bridge Client
 * Connects the MCP server to the VSCode extension via IPC
 */

import * as net from "node:net";

/**
 * Request to send to extension
 */
interface BridgeRequest {
  id: string;
  method: string;
  params: unknown;
}

/**
 * Response from extension
 */
interface BridgeResponse {
  id: string;
  result?: unknown;
  error?: string;
}

/**
 * Extension Bridge class
 * Manages IPC connection to the VSCode extension
 */
export class ExtensionBridge {
  private socket: net.Socket | null = null;
  private connected = false;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
    }
  >();
  private buffer = "";
  private requestId = 0;

  constructor(private socketPath: string) {}

  /**
   * Connect to the extension bridge server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.socketPath);

      this.socket.on("connect", () => {
        this.connected = true;
        resolve();
      });

      this.socket.on("data", (data) => {
        this.handleData(data);
      });

      this.socket.on("error", (error) => {
        if (!this.connected) {
          reject(error);
        } else {
          console.error("[ExtensionBridge] Socket error:", error);
        }
      });

      this.socket.on("close", () => {
        this.connected = false;
        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
          reject(new Error("Connection closed"));
          this.pendingRequests.delete(id);
        }
      });
    });
  }

  /**
   * Handle incoming data from the socket
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete lines (newline-delimited JSON)
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: BridgeResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        console.error("[ExtensionBridge] Failed to parse response:", error);
      }
    }
  }

  /**
   * Call a method on the extension
   */
  async call<TResult = unknown>(
    method: string,
    params: unknown,
  ): Promise<TResult> {
    const socket = this.socket;
    if (!this.connected || !socket) {
      throw new Error("Not connected to extension");
    }

    const id = `req-${++this.requestId}-${Date.now()}`;
    const request: BridgeRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      socket.write(`${JSON.stringify(request)}\n`);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from the extension
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }
}

/**
 * Singleton bridge instance
 */
let bridgeInstance: ExtensionBridge | null = null;

/**
 * Get or create the extension bridge
 */
export function getExtensionBridge(): ExtensionBridge {
  if (!bridgeInstance) {
    const socketPath = process.env.CLIVE_SOCKET;
    if (!socketPath) {
      throw new Error("CLIVE_SOCKET environment variable not set");
    }
    bridgeInstance = new ExtensionBridge(socketPath);
  }
  return bridgeInstance;
}

/**
 * Connect the bridge if not already connected
 */
export async function ensureBridgeConnected(): Promise<ExtensionBridge> {
  const bridge = getExtensionBridge();
  if (!bridge.isConnected()) {
    await bridge.connect();
  }
  return bridge;
}
