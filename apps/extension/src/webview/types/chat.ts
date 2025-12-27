export interface ToolEvent {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  output?: unknown;
  errorText?: string;
  timestamp: Date;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
}

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export type MessagePart =
  | { type: "text"; text: string }
  | {
      type: `tool-${string}`;
      toolName: string;
      toolCallId: string;
      state: ToolState;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      streamingContent?: string; // For file-writing tools that stream content
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  timestamp: Date;
  isStreaming?: boolean;
}
