package model

import "time"

// OutputType represents the type of output line
type OutputType string

const (
	OutputTypeStdout     OutputType = "stdout"
	OutputTypeStderr     OutputType = "stderr"
	OutputTypeSystem     OutputType = "system"
	OutputTypeMarker     OutputType = "marker"
	OutputTypeToolCall   OutputType = "tool_call"
	OutputTypeToolResult OutputType = "tool_result"
	OutputTypeUserInput  OutputType = "user_input"
	OutputTypeAssistant  OutputType = "assistant"
)

// OutputLine represents a single line of output
type OutputLine struct {
	ID        string
	Text      string
	Type      OutputType
	Timestamp time.Time
	ToolName  string // For tool_call type
	Indent    int    // Indentation level (0, 1, 2)
	BlockID   string // Groups related lines (assistant text + tool calls)
}

// ResponseBlock groups an assistant message with its tool calls
type ResponseBlock struct {
	ID            string
	AssistantText []string
	Tools         []ToolCall
	Type          string // "assistant", "system", "other"
}

// ToolCall represents a tool call within a response block
type ToolCall struct {
	Name   string
	Text   string
	Result string
}
