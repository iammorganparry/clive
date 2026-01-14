/**
 * Claude CLI NDJSON Event Parser
 * Parses streaming events from Claude CLI's --output-format stream-json
 */

/**
 * Question option from AskUserQuestion tool
 */
export interface QuestionOption {
  label: string;
  description?: string;
}

/**
 * Question from AskUserQuestion tool
 */
export interface AgentQuestion {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/**
 * Parsed event types from Claude CLI
 */
export type ClaudeEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: string }
  | { type: "question"; id: string; questions: AgentQuestion[] }
  | { type: "approval_requested"; id: string; toolName: string; args: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * Tools that require user approval before executing
 */
const APPROVAL_REQUIRED_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"];

/**
 * Parse a single line of NDJSON output from Claude CLI
 */
export function parseClaudeEvent(line: string): ClaudeEvent | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

    // Handle content_block_start for tool_use
    if (data.type === "content_block_start") {
      if (data.content_block?.type === "tool_use") {
        const toolName = data.content_block.name;
        const toolId = data.content_block.id;
        const input = data.content_block.input || {};

        // Check if this is an AskUserQuestion tool
        if (toolName === "AskUserQuestion") {
          const questions = input.questions as AgentQuestion[] | undefined;
          if (questions && Array.isArray(questions)) {
            return {
              type: "question",
              id: toolId,
              questions,
            };
          }
        }

        // Check if this tool requires approval
        if (APPROVAL_REQUIRED_TOOLS.includes(toolName)) {
          return {
            type: "approval_requested",
            id: toolId,
            toolName,
            args: input,
          };
        }

        return {
          type: "tool_use",
          id: toolId,
          name: toolName,
          input,
        };
      }
      if (data.content_block?.type === "thinking") {
        return {
          type: "thinking",
          content: data.content_block.thinking || "",
        };
      }
    }

    // Handle content_block_delta
    if (data.type === "content_block_delta") {
      if (data.delta?.type === "text_delta") {
        return { type: "text", content: data.delta.text };
      }
      if (data.delta?.type === "thinking_delta") {
        return { type: "thinking", content: data.delta.thinking };
      }
      // input_json_delta - tool input streaming, ignore for now
      return null;
    }

    // Handle message_start - contains model info
    if (data.type === "message_start") {
      return null;
    }

    // Handle message_delta - contains stop reason
    if (data.type === "message_delta") {
      if (
        data.delta?.stop_reason === "end_turn" ||
        data.delta?.stop_reason === "tool_use"
      ) {
        return { type: "done" };
      }
      return null;
    }

    // Handle message_stop or result
    if (data.type === "message_stop" || data.type === "result") {
      return { type: "done" };
    }

    // Handle assistant message with content array
    if (data.type === "assistant" && data.message?.content) {
      for (const block of data.message.content) {
        if (block.type === "text") {
          return { type: "text", content: block.text };
        }
        if (block.type === "tool_use") {
          const toolName = block.name;
          const toolId = block.id;

          // Check if this is an AskUserQuestion tool
          if (toolName === "AskUserQuestion") {
            const questions = block.input?.questions as
              | AgentQuestion[]
              | undefined;
            if (questions && Array.isArray(questions)) {
              return {
                type: "question",
                id: toolId,
                questions,
              };
            }
          }

          // Check if this tool requires approval
          if (APPROVAL_REQUIRED_TOOLS.includes(toolName)) {
            return {
              type: "approval_requested",
              id: toolId,
              toolName,
              args: block.input,
            };
          }

          return {
            type: "tool_use",
            id: toolId,
            name: toolName,
            input: block.input,
          };
        }
        if (block.type === "thinking") {
          return { type: "thinking", content: block.thinking };
        }
      }
    }

    // Handle error events
    if (data.type === "error") {
      return {
        type: "error",
        message: data.error?.message || data.message || "Unknown error",
      };
    }

    // Ignore system events
    if (data.type === "system") {
      return null;
    }

    // Handle user events containing tool_result
    if (data.type === "user") {
      const content = data.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            return {
              type: "tool_result",
              id: block.tool_use_id,
              content:
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content),
            };
          }
        }
      }
      return null;
    }

    // Unknown event type
    return null;
  } catch {
    // Not valid JSON, treat as plain text output
    return { type: "text", content: line };
  }
}

/**
 * Format a tool result message to send back to Claude CLI via stdin
 */
export function formatToolResult(toolCallId: string, result: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolCallId,
          content: result,
        },
      ],
    },
  });
}

/**
 * Format an AskUserQuestion response
 */
export function formatQuestionResponse(
  toolCallId: string,
  answers: Record<string, string>,
): string {
  return formatToolResult(toolCallId, JSON.stringify({ answers }));
}

/**
 * Format an approval response (yes/no)
 */
export function formatApprovalResponse(
  toolCallId: string,
  approved: boolean,
): string {
  // For approval, we just need to signal the result
  // The CLI will continue execution if approved, or skip if denied
  return formatToolResult(
    toolCallId,
    JSON.stringify({ approved, result: approved ? "approved" : "denied" }),
  );
}
