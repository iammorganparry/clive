import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { MessageTransport } from "../transport.js";
import type {
  RpcMessage,
  RpcResponse,
  RpcSubscriptionUpdate,
} from "../types.js";

/**
 * Stdio message transport for Node.js processes
 * Uses newline-delimited JSON (NDJSON) for message framing
 */
export class StdioMessageTransport implements MessageTransport {
  private pendingRequests = new Map<
    string,
    {
      resolve: (response: RpcResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private subscriptions = new Map<
    string,
    (update: RpcSubscriptionUpdate) => void
  >();

  private messageIdCounter = 0;
  private rl: readline.Interface | null = null;

  constructor(
    private input: Readable,
    private output: Writable,
    private timeoutMs = 30000,
  ) {
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    this.rl = readline.createInterface({
      input: this.input,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    this.rl.on("line", (line: string) => {
      if (!line.trim()) return;

      try {
        const data = JSON.parse(line) as
          | RpcResponse
          | RpcSubscriptionUpdate
          | { type: string; [key: string]: unknown };

        // Handle RPC response (has 'success' field)
        if ("id" in data && "success" in data && typeof data.id === "string") {
          const pending = this.pendingRequests.get(data.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(data.id);
            if (data.success) {
              pending.resolve(data as RpcResponse);
            } else {
              pending.reject(
                new Error(
                  (data as RpcResponse).error?.message || "Unknown error",
                ),
              );
            }
          }
          return;
        }

        // Handle subscription update (has 'type' field: data|complete|error)
        if (
          "id" in data &&
          "type" in data &&
          typeof data.id === "string" &&
          (data.type === "data" ||
            data.type === "complete" ||
            data.type === "error")
        ) {
          const handler = this.subscriptions.get(data.id);
          if (handler) {
            handler(data as RpcSubscriptionUpdate);

            // Clean up on complete or error
            if (data.type === "complete" || data.type === "error") {
              this.subscriptions.delete(data.id);
            }
          }
          return;
        }
      } catch (err) {
        // Failed to parse JSON - ignore malformed messages
        console.error("[StdioTransport] Failed to parse message:", err);
      }
    });

    this.rl.on("close", () => {
      // Reject all pending requests
      for (const [_id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Transport closed"));
      }
      this.pendingRequests.clear();
      this.subscriptions.clear();
    });
  }

  request(message: RpcMessage): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error("Request timeout"));
      }, this.timeoutMs);

      this.pendingRequests.set(message.id, { resolve, reject, timeout });
      this.sendMessage(message);
    });
  }

  subscribe(
    message: RpcMessage,
    onUpdate: (update: RpcSubscriptionUpdate) => void,
  ): () => void {
    this.subscriptions.set(message.id, onUpdate);
    this.sendMessage(message);

    return () => {
      this.subscriptions.delete(message.id);
      // Send unsubscribe message
      const unsubscribeMessage: RpcMessage = {
        id: message.id,
        type: "subscription",
        path: message.path,
        input:
          message.input &&
          typeof message.input === "object" &&
          !Array.isArray(message.input)
            ? { ...message.input, _unsubscribe: true }
            : { _unsubscribe: true },
      };
      this.sendMessage(unsubscribeMessage);
    };
  }

  send(message: RpcMessage): void {
    this.sendMessage(message);
  }

  private sendMessage(message: unknown): void {
    const json = JSON.stringify(message);
    this.output.write(`${json}\n`);
  }

  generateId(): string {
    return `rpc-${Date.now()}-${++this.messageIdCounter}`;
  }

  /**
   * Clean up resources - call when done with transport
   */
  dispose(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // Clear all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();
    this.subscriptions.clear();
  }
}
