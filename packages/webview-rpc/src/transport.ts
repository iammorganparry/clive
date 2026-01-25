import type {
  RpcMessage,
  RpcResponse,
  RpcSubscriptionUpdate,
} from "./types.js";

/**
 * Transport interface for sending/receiving RPC messages
 */
export interface MessageTransport {
  /**
   * Send a message and wait for a response
   */
  request(message: RpcMessage): Promise<RpcResponse>;

  /**
   * Subscribe to a stream of updates
   */
  subscribe(
    message: RpcMessage,
    onUpdate: (update: RpcSubscriptionUpdate) => void,
  ): () => void; // Returns unsubscribe function

  /**
   * Send a one-way message (no response expected)
   */
  send(message: RpcMessage): void;
}

/**
 * VS Code webview message transport implementation
 */
export class VSCodeMessageTransport implements MessageTransport {
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

  constructor(
    private postMessage: (message: unknown) => void,
    onMessage: (handler: (event: MessageEvent) => void) => void,
    private timeout = 30000,
  ) {
    // Set up message listener
    onMessage((event: MessageEvent) => {
      const data = event.data as
        | RpcResponse
        | RpcSubscriptionUpdate
        | { type: string; [key: string]: unknown };

      // Handle RPC response
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

      // Handle subscription update
      if (
        "id" in data &&
        "type" in data &&
        typeof data.id === "string" &&
        data.type !== "query" &&
        data.type !== "mutation"
      ) {
        const handler = this.subscriptions.get(data.id);
        if (handler) {
          handler(data as RpcSubscriptionUpdate);
        }
        return;
      }
    });
  }

  request(message: RpcMessage): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error("Request timeout"));
      }, this.timeout);

      this.pendingRequests.set(message.id, { resolve, reject, timeout });
      this.postMessage(message);
    });
  }

  subscribe(
    message: RpcMessage,
    onUpdate: (update: RpcSubscriptionUpdate) => void,
  ): () => void {
    this.subscriptions.set(message.id, onUpdate);
    this.postMessage(message);

    return () => {
      this.subscriptions.delete(message.id);
      // Optionally send unsubscribe message
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
      this.postMessage(unsubscribeMessage);
    };
  }

  send(message: RpcMessage): void {
    this.postMessage(message);
  }

  generateId(): string {
    return `rpc-${Date.now()}-${++this.messageIdCounter}`;
  }
}
