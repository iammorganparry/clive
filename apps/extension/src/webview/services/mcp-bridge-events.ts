/**
 * MCP Bridge Event Emitter
 * Handles events from the MCP bridge that need to be processed in the webview
 */

type Listener<T> = (data: T) => void;

/**
 * Event types emitted by the MCP bridge
 */
export interface McpBridgeEvents {
  "plan-approval": {
    approved: boolean;
    planId?: string;
    feedback?: string;
    approvalMode?: "auto" | "manual";
  };
  "summarize-context": {
    summary: string;
    tokensBefore?: number;
    tokensAfter?: number;
    preserveKnowledge: boolean;
  };
  "plan-content-streaming": {
    toolCallId: string;
    content: string;
    isComplete: boolean;
    filePath?: string;
  };
}

type EventName = keyof McpBridgeEvents;

/**
 * Simple typed event emitter for MCP bridge events
 * Uses a Map-based implementation suitable for webview environment
 */
class McpBridgeEventEmitter {
  private listeners = new Map<EventName, Set<Listener<unknown>>>();

  /**
   * Subscribe to an event
   */
  on<E extends EventName>(
    event: E,
    listener: Listener<McpBridgeEvents[E]>,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener as Listener<unknown>);
  }

  /**
   * Unsubscribe from an event
   */
  off<E extends EventName>(
    event: E,
    listener: Listener<McpBridgeEvents[E]>,
  ): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener as Listener<unknown>);
    }
  }

  /**
   * Emit an event to all listeners
   */
  emit<E extends EventName>(event: E, data: McpBridgeEvents[E]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`[MCP Bridge Event] Error in listener for ${event}:`, error);
        }
      }
    }
  }

  /**
   * Remove all listeners for an event (or all events if no event specified)
   */
  removeAllListeners(event?: EventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: EventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/**
 * Singleton instance of the MCP bridge event emitter
 */
export const mcpBridgeEventEmitter = new McpBridgeEventEmitter();
