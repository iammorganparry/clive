package process

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestPermissionApproval_DetectsAndApproves verifies automatic permission approval
func TestPermissionApproval_DetectsAndApproves(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Simulate permission request from claude-code
	toolID := "toolu_permission_test"
	permissionRequestJSON := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Answer questions?","is_error":true,"tool_use_id":"` + toolID + `"}]},"parent_tool_use_id":null,"session_id":"test-session","uuid":"test-uuid","tool_use_result":"Error: Answer questions?"}`

	// Process the permission request
	output := parseNDJSONLine(permissionRequestJSON, handle)

	// Verify debug output was generated
	if len(output) == 0 {
		t.Fatal("Expected debug output from permission request detection")
	}

	foundDebug := false
	for _, line := range output {
		if line.Type == "debug" && strings.Contains(line.DebugInfo, "PERMISSION REQUEST detected") {
			foundDebug = true
			if !strings.Contains(line.DebugInfo, toolID) {
				t.Errorf("Debug message should contain tool_use_id %s", toolID)
			}
			if !strings.Contains(line.DebugInfo, "sent approval via stdin") {
				t.Error("Debug message should indicate approval was sent")
			}
		}
	}

	if !foundDebug {
		t.Error("Permission request detection debug message not found")
	}

	// Verify approval was written to stdin
	writtenData := writer.target.data
	if len(writtenData) == 0 {
		t.Fatal("No approval written to stdin")
	}

	// Parse the written JSON
	var approval map[string]interface{}
	if err := json.Unmarshal(writtenData, &approval); err != nil {
		t.Fatalf("Failed to parse approval JSON: %v\nData: %s", err, string(writtenData))
	}

	// Verify approval message structure
	if approval["type"] != "user" {
		t.Errorf("Expected type 'user', got: %v", approval["type"])
	}

	message, ok := approval["message"].(map[string]interface{})
	if !ok {
		t.Fatal("Approval missing 'message' field")
	}

	content, ok := message["content"].([]interface{})
	if !ok || len(content) != 1 {
		t.Fatal("Approval message should have exactly 1 content block")
	}

	toolResult, ok := content[0].(map[string]interface{})
	if !ok {
		t.Fatal("Content block should be a map")
	}

	// Verify tool_result fields
	if toolResult["type"] != "tool_result" {
		t.Errorf("Expected type 'tool_result', got: %v", toolResult["type"])
	}

	if toolResult["tool_use_id"] != toolID {
		t.Errorf("Expected tool_use_id %s, got: %v", toolID, toolResult["tool_use_id"])
	}

	if toolResult["is_error"] != false {
		t.Error("Approval should have is_error=false")
	}

	// Empty content means approved
	if toolResult["content"] != "" {
		t.Errorf("Approval content should be empty string, got: %v", toolResult["content"])
	}
}

// TestPermissionApproval_IgnoresNonPermissionUserEvents verifies we don't process regular user messages
func TestPermissionApproval_IgnoresNonPermissionUserEvents(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Simulate non-permission user event (is_error=false)
	normalUserJSON := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Normal answer","is_error":false,"tool_use_id":"toolu_normal"}]}}`

	// Process the event
	parseNDJSONLine(normalUserJSON, handle)

	// Verify no approval was sent (data should be empty or just debug log)
	writtenData := writer.target.data
	if len(writtenData) > 0 {
		// Should only contain debug log, not an approval
		dataStr := string(writtenData)
		if strings.Contains(dataStr, `"is_error":false`) && strings.Contains(dataStr, `"tool_result"`) {
			// This would be an approval - should not happen
			if strings.Count(dataStr, `"tool_result"`) > 0 {
				t.Error("Should not send approval for non-permission user events")
			}
		}
	}
}

// TestPermissionApproval_MultiplePermissionRequests verifies handling multiple permissions
func TestPermissionApproval_MultiplePermissionRequests(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Simulate multiple permission requests
	toolIDs := []string{"toolu_perm1", "toolu_perm2", "toolu_perm3"}

	for _, toolID := range toolIDs {
		permissionRequestJSON := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Answer questions?","is_error":true,"tool_use_id":"` + toolID + `"}]}}`

		// Clear writer data for next test
		writer.target.data = writer.target.data[:0]

		// Process permission request
		parseNDJSONLine(permissionRequestJSON, handle)

		// Verify approval was sent for this specific toolID
		writtenData := writer.target.data
		if !strings.Contains(string(writtenData), toolID) {
			t.Errorf("Approval for %s not found in stdin", toolID)
		}
	}
}

// TestPermissionApproval_ConcurrentPermissionRequests verifies thread safety
func TestPermissionApproval_ConcurrentPermissionRequests(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Launch concurrent permission requests
	numRequests := 10
	done := make(chan bool, numRequests)

	for i := 0; i < numRequests; i++ {
		go func(id int) {
			toolID := "toolu_concurrent_" + string(rune('0'+id))
			permissionRequestJSON := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Answer questions?","is_error":true,"tool_use_id":"` + toolID + `"}]}}`

			parseNDJSONLine(permissionRequestJSON, handle)
			done <- true
		}(i)
	}

	// Wait for all to complete
	for i := 0; i < numRequests; i++ {
		<-done
	}

	// Give time for any buffered writes
	time.Sleep(50 * time.Millisecond)

	// Verify all approvals were written
	writtenData := writer.target.data
	dataStr := string(writtenData)

	// Count approval messages (one per line)
	approvalCount := strings.Count(dataStr, `"type":"tool_result"`)
	if approvalCount != numRequests {
		t.Errorf("Expected %d approvals, found %d", numRequests, approvalCount)
	}
}

// TestPermissionApproval_MalformedPermissionRequest verifies graceful handling of bad data
func TestPermissionApproval_MalformedPermissionRequest(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	testCases := []struct {
		name string
		json string
	}{
		{
			name: "Missing tool_use_id",
			json: `{"type":"user","message":{"content":[{"type":"tool_result","content":"Test","is_error":true}]}}`,
		},
		{
			name: "Missing is_error",
			json: `{"type":"user","message":{"content":[{"type":"tool_result","content":"Test","tool_use_id":"toolu_test"}]}}`,
		},
		{
			name: "Empty content array",
			json: `{"type":"user","message":{"content":[]}}`,
		},
		{
			name: "Invalid JSON",
			json: `{"type":"user","message":{"content":[{"type":"tool_result"`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear previous data
			writer.target.data = writer.target.data[:0]

			// Should not panic
			output := parseNDJSONLine(tc.json, handle)

			// Should either return nil or debug output, but not crash
			if len(output) > 0 {
				for _, line := range output {
					if line.Type == "debug" {
						// Debug output is fine
						continue
					}
				}
			}

			// Should not write malformed approval
			writtenData := writer.target.data
			if len(writtenData) > 0 {
				// If it wrote something, it should be valid JSON
				var check map[string]interface{}
				if err := json.Unmarshal(writtenData, &check); err != nil {
					t.Errorf("Wrote invalid JSON: %v", err)
				}
			}
		})
	}
}

// TestPermissionApproval_PreservesToolUseTracking verifies permission approval doesn't interfere with tool tracking
func TestPermissionApproval_PreservesToolUseTracking(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Add a tracked tool_use (would come from assistant message)
	toolID := "toolu_tracked"
	handle.conversationMu.Lock()
	handle.pendingToolUses[toolID] = ToolUseBlock{
		ID:   toolID,
		Name: "AskUserQuestion",
	}
	initialCount := len(handle.pendingToolUses)
	handle.conversationMu.Unlock()

	// Simulate permission request for the same tool_use_id
	permissionRequestJSON := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Answer questions?","is_error":true,"tool_use_id":"` + toolID + `"}]}}`

	parseNDJSONLine(permissionRequestJSON, handle)

	// Verify tool_use is still tracked (permission approval doesn't remove it)
	handle.conversationMu.Lock()
	finalCount := len(handle.pendingToolUses)
	_, stillExists := handle.pendingToolUses[toolID]
	handle.conversationMu.Unlock()

	if finalCount != initialCount {
		t.Errorf("Permission approval should not modify pendingToolUses count. Before: %d, After: %d", initialCount, finalCount)
	}

	if !stillExists {
		t.Error("Permission approval should not remove tool_use from tracking")
	}
}

// TestPermissionApproval_IntegrationWithAskUserQuestion verifies end-to-end flow
func TestPermissionApproval_IntegrationWithAskUserQuestion(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	toolID := "toolu_integration_test"

	// Step 1: Assistant sends AskUserQuestion tool_use
	toolUseJSON := `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"` + toolID + `","name":"AskUserQuestion","input":{"questions":[{"question":"Test?","header":"Test","options":[{"label":"Yes"}],"multiSelect":false}]}}]}}`

	parseNDJSONLine(toolUseJSON, handle)

	// Verify tool was tracked
	handle.conversationMu.Lock()
	_, tracked := handle.pendingToolUses[toolID]
	handle.conversationMu.Unlock()

	if !tracked {
		t.Fatal("Tool_use should be tracked after assistant message")
	}

	// Clear stdin data
	writer.target.data = writer.target.data[:0]

	// Step 2: Claude-code sends permission request
	permissionRequestJSON := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Answer questions?","is_error":true,"tool_use_id":"` + toolID + `"}]}}`

	parseNDJSONLine(permissionRequestJSON, handle)

	// Verify approval was sent
	approvalData := writer.target.data
	if len(approvalData) == 0 {
		t.Fatal("No approval sent after permission request")
	}

	if !strings.Contains(string(approvalData), toolID) {
		t.Error("Approval should reference the correct tool_use_id")
	}

	// Step 3: User sends actual answer via SendToolResult
	err := handle.SendToolResult(toolID, `{"Test?":"Yes"}`)
	if err != nil {
		t.Errorf("User answer should succeed: %v", err)
	}

	// Verify tool_use was cleaned up after answer
	handle.conversationMu.Lock()
	_, stillTracked := handle.pendingToolUses[toolID]
	handle.conversationMu.Unlock()

	if stillTracked {
		t.Error("Tool_use should be removed after user answer")
	}
}
