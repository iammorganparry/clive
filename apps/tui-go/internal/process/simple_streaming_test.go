package process

import (
	"fmt"
	"testing"
)

func TestSimpleStreaming_Debug(t *testing.T) {
	// Reset state
	ResetStreamingState()

	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
	}

	// Step 1: content_block_start
	line1 := `{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_test123","name":"AskUserQuestion"}}`
	fmt.Printf("Parsing line 1: %s\n", line1)
	outputs1 := parseNDJSONLine(line1, handle)
	fmt.Printf("Outputs from line 1: %d outputs\n", len(outputs1))
	for i, out := range outputs1 {
		fmt.Printf("  Output %d: Type=%s, Text=%s\n", i, out.Type, out.Text)
	}

	// Check global state after content_block_start
	streamStateMu.Lock()
	fmt.Printf("After line 1 - currentToolName=%s, currentToolID=%s\n", currentToolName, currentToolID)
	streamStateMu.Unlock()

	// Step 2: content_block_delta with input JSON
	line2 := `{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"questions\":[{\"question\":\"Test?\",\"header\":\"Test\",\"options\":[{\"label\":\"Yes\",\"description\":\"Y\"},{\"label\":\"No\",\"description\":\"N\"}],\"multiSelect\":false}]}"}}`
	fmt.Printf("\nParsing line 2: %s\n", line2[:80] + "...")
	outputs2 := parseNDJSONLine(line2, handle)
	fmt.Printf("Outputs from line 2: %d outputs\n", len(outputs2))

	// Check global state after delta
	streamStateMu.Lock()
	fmt.Printf("After line 2 - currentToolInput length=%d\n", currentToolInput.Len())
	streamStateMu.Unlock()

	// Step 3: content_block_stop
	line3 := `{"type":"content_block_stop","index":0}`
	fmt.Printf("\nParsing line 3: %s\n", line3)
	outputs3 := parseNDJSONLine(line3, handle)
	fmt.Printf("Outputs from line 3: %d outputs\n", len(outputs3))
	for i, out := range outputs3 {
		fmt.Printf("  Output %d: Type=%s\n", i, out.Type)
		if out.Question != nil && len(out.Question.Questions) > 0 {
			fmt.Printf("    Question: ToolUseID=%s, Header=%s\n", out.Question.ToolUseID, out.Question.Questions[0].Header)
		}
	}

	// Check if tool_use was tracked
	handle.conversationMu.Lock()
	trackedCount := len(handle.pendingToolUses)
	var trackedIDs []string
	for id := range handle.pendingToolUses {
		trackedIDs = append(trackedIDs, id)
	}
	handle.conversationMu.Unlock()
	fmt.Printf("\nTracked tool_uses: %d\n", trackedCount)
	for _, id := range trackedIDs {
		fmt.Printf("  - %s\n", id)
	}
}
