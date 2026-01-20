package process

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

func TestToolUseTracking_StreamingPath(t *testing.T) {
	// Reset global streaming state
	ResetStreamingState()

	// Test tool_use tracking in streaming path (content_block_stop)
	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Simulate streaming events for AskUserQuestion
	// 1. content_block_start with tool_use (doesn't emit output, just sets state)
	startLine := `{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_stream123","name":"AskUserQuestion"}}`
	parseNDJSONLine(startLine, handle)

	// 2. content_block_delta with input JSON
	deltaLine := `{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"questions\":[{\"question\":\"Test?\",\"header\":\"Test\",\"options\":[{\"label\":\"Yes\",\"description\":\"Y\"},{\"label\":\"No\",\"description\":\"N\"}],\"multiSelect\":false}]}"}}`
	parseNDJSONLine(deltaLine, handle)

	// 3. content_block_stop (should emit question and save tool_use)
	stopLine := `{"type":"content_block_stop","index":0}`
	outputs := parseNDJSONLine(stopLine, handle)

	// Verify question was emitted
	foundQuestion := false
	var questionToolUseID string
	for _, output := range outputs {
		if output.Type == "question" && output.Question != nil {
			foundQuestion = true
			questionToolUseID = output.Question.ToolUseID
			break
		}
	}

	if !foundQuestion {
		t.Error("Expected ask_user output from streaming path")
	}

	// Verify tool_use was tracked
	handle.conversationMu.Lock()
	toolUse, exists := handle.pendingToolUses[questionToolUseID]
	handle.conversationMu.Unlock()

	if !exists {
		t.Errorf("Expected tool_use_id %s to be tracked, but not found", questionToolUseID)
	}
	if toolUse.Name != "AskUserQuestion" {
		t.Errorf("Expected tool name AskUserQuestion, got %s", toolUse.Name)
	}
}

func TestToolUseTracking_AssistantMessagePath(t *testing.T) {
	// Test tool_use tracking in assistant message fallback path
	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Simulate assistant message with tool_use
	assistantMsg := map[string]interface{}{
		"type": "assistant",
		"message": map[string]interface{}{
			"role": "assistant",
			"content": []interface{}{
				map[string]interface{}{
					"type": "tool_use",
					"id":   "toolu_assistant456",
					"name": "AskUserQuestion",
					"input": map[string]interface{}{
						"questions": []interface{}{
							map[string]interface{}{
								"question":    "Test question?",
								"header":      "TestHeader",
								"multiSelect": false,
								"options": []interface{}{
									map[string]interface{}{
										"label":       "Option A",
										"description": "Description A",
									},
									map[string]interface{}{
										"label":       "Option B",
										"description": "Description B",
									},
								},
							},
						},
					},
				},
			},
		},
	}

	msgJSON, _ := json.Marshal(assistantMsg)
	outputs := parseNDJSONLine(string(msgJSON), handle)

	// Verify question was emitted
	foundQuestion := false
	var questionToolUseID string
	for _, output := range outputs {
		if output.Type == "question" && output.Question != nil {
			foundQuestion = true
			questionToolUseID = output.Question.ToolUseID
			break
		}
	}

	if !foundQuestion {
		t.Error("Expected ask_user output from assistant message path")
	}

	// Verify tool_use was tracked
	handle.conversationMu.Lock()
	toolUse, exists := handle.pendingToolUses[questionToolUseID]
	handle.conversationMu.Unlock()

	if !exists {
		t.Errorf("Expected tool_use_id %s to be tracked, but not found", questionToolUseID)
	}
	if toolUse.ID != "toolu_assistant456" {
		t.Errorf("Expected tool_use_id=toolu_assistant456, got %s", toolUse.ID)
	}
	if toolUse.Name != "AskUserQuestion" {
		t.Errorf("Expected tool name AskUserQuestion, got %s", toolUse.Name)
	}
}

func TestQuestionDeduplication_SameToolUseID(t *testing.T) {
	// Reset global state
	ResetStreamingState()

	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// First question
	assistantMsg := map[string]interface{}{
		"type": "assistant",
		"message": map[string]interface{}{
			"role": "assistant",
			"content": []interface{}{
				map[string]interface{}{
					"type": "tool_use",
					"id":   "toolu_dedup123",
					"name": "AskUserQuestion",
					"input": map[string]interface{}{
						"questions": []interface{}{
							map[string]interface{}{
								"question":    "Same question",
								"header":      "Test",
								"multiSelect": false,
								"options": []interface{}{
									map[string]interface{}{"label": "A", "description": "A"},
									map[string]interface{}{"label": "B", "description": "B"},
								},
							},
						},
					},
				},
			},
		},
	}

	msgJSON, _ := json.Marshal(assistantMsg)

	// First call should emit question
	outputs1 := parseNDJSONLine(string(msgJSON), handle)
	foundFirst := false
	for _, output := range outputs1 {
		if output.Type == "question" {
			foundFirst = true
			break
		}
	}
	if !foundFirst {
		t.Error("Expected first question to be emitted")
	}

	// Second call with same tool_use_id should be deduplicated
	outputs2 := parseNDJSONLine(string(msgJSON), handle)
	foundSecond := false
	for _, output := range outputs2 {
		if output.Type == "question" {
			foundSecond = true
			break
		}
	}
	if foundSecond {
		t.Error("Expected second question with same tool_use_id to be deduplicated")
	}
}

func TestQuestionDeduplication_DifferentToolUseID(t *testing.T) {
	// Reset global state
	ResetStreamingState()

	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Create two questions with different tool_use_ids
	createQuestion := func(toolID string) string {
		msg := map[string]interface{}{
			"type": "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []interface{}{
					map[string]interface{}{
						"type": "tool_use",
						"id":   toolID,
						"name": "AskUserQuestion",
						"input": map[string]interface{}{
							"questions": []interface{}{
								map[string]interface{}{
									"question":    "Question with ID " + toolID,
									"header":      "Test",
									"multiSelect": false,
									"options": []interface{}{
										map[string]interface{}{"label": "A", "description": "A"},
										map[string]interface{}{"label": "B", "description": "B"},
									},
								},
							},
						},
					},
				},
			},
		}
		msgJSON, _ := json.Marshal(msg)
		return string(msgJSON)
	}

	// First question
	outputs1 := parseNDJSONLine(createQuestion("toolu_first"), handle)
	foundFirst := false
	for _, output := range outputs1 {
		if output.Type == "question" {
			foundFirst = true
			break
		}
	}
	if !foundFirst {
		t.Error("Expected first question to be emitted")
	}

	// Second question with different ID should be DISCARDED (new behavior to prevent 400 errors)
	// Only ONE question per turn is allowed
	outputs2 := parseNDJSONLine(createQuestion("toolu_second"), handle)
	foundSecond := false
	for _, output := range outputs2 {
		if output.Type == "question" {
			foundSecond = true
			break
		}
	}
	if foundSecond {
		t.Error("Expected second question with different tool_use_id to be discarded (only one question per turn)")
	}
}

func TestSendToolResult_ValidID(t *testing.T) {
	// Create a mock ProcessHandle with stdin
	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Add a tracked tool_use
	handle.conversationMu.Lock()
	handle.pendingToolUses["toolu_valid123"] = ToolUseBlock{
		ID:   "toolu_valid123",
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// Send tool result
	err := handle.SendToolResult("toolu_valid123", "User's answer")
	if err != nil {
		t.Errorf("Expected no error for valid tool_use_id, got: %v", err)
	}

	// Verify tool_use was removed after successful send
	handle.conversationMu.Lock()
	_, exists := handle.pendingToolUses["toolu_valid123"]
	handle.conversationMu.Unlock()

	if exists {
		t.Error("Expected tool_use to be removed after successful send")
	}
}

func TestSendToolResult_InvalidID(t *testing.T) {
	// Create a mock ProcessHandle
	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Try to send tool result for non-existent tool_use_id
	err := handle.SendToolResult("toolu_invalid999", "User's answer")
	if err == nil {
		t.Error("Expected error for invalid tool_use_id, got nil")
	}

	if !strings.Contains(err.Error(), "not found in conversation") {
		t.Errorf("Expected error message about 'not found in conversation', got: %v", err)
	}
}

func TestSendToolResult_StaleID(t *testing.T) {
	// Simulate the case where a tool_use_id was valid but has been cleaned up
	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Add a tool_use
	handle.conversationMu.Lock()
	handle.pendingToolUses["toolu_stale456"] = ToolUseBlock{
		ID:   "toolu_stale456",
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// Send successfully (should remove from map)
	err := handle.SendToolResult("toolu_stale456", "First answer")
	if err != nil {
		t.Fatalf("First send should succeed: %v", err)
	}

	// Try to send again with same ID (should fail - stale)
	err = handle.SendToolResult("toolu_stale456", "Second answer")
	if err == nil {
		t.Error("Expected error for stale tool_use_id, got nil")
	}
}

func TestResetStreamingState_ClearsQuestionDedup(t *testing.T) {
	// Reset state
	ResetStreamingState()

	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Create a question
	assistantMsg := map[string]interface{}{
		"type": "assistant",
		"message": map[string]interface{}{
			"role": "assistant",
			"content": []interface{}{
				map[string]interface{}{
					"type": "tool_use",
					"id":   "toolu_reset789",
					"name": "AskUserQuestion",
					"input": map[string]interface{}{
						"questions": []interface{}{
							map[string]interface{}{
								"question":    "Test",
								"header":      "Test",
								"multiSelect": false,
								"options": []interface{}{
									map[string]interface{}{"label": "A", "description": "A"},
									map[string]interface{}{"label": "B", "description": "B"},
								},
							},
						},
					},
				},
			},
		},
	}

	msgJSON, _ := json.Marshal(assistantMsg)

	// First call should emit
	outputs1 := parseNDJSONLine(string(msgJSON), handle)
	foundFirst := false
	for _, output := range outputs1 {
		if output.Type == "question" {
			foundFirst = true
			break
		}
	}
	if !foundFirst {
		t.Error("Expected first question to be emitted")
	}

	// Second call should be deduplicated
	outputs2 := parseNDJSONLine(string(msgJSON), handle)
	foundSecond := false
	for _, output := range outputs2 {
		if output.Type == "question" {
			foundSecond = true
			break
		}
	}
	if foundSecond {
		t.Error("Expected second question to be deduplicated")
	}

	// Reset streaming state (both global and per-handle)
	ResetStreamingState()
	// Also reset the per-handle flags so the next question can be shown
	handle.mu.Lock()
	handle.questionSeenThisTurn = false
	handle.skipUntilToolResult = false
	handle.mu.Unlock()

	// After reset, same question should be emitted again
	outputs3 := parseNDJSONLine(string(msgJSON), handle)
	foundThird := false
	for _, output := range outputs3 {
		if output.Type == "question" {
			foundThird = true
			break
		}
	}
	if !foundThird {
		t.Error("Expected question to be emitted after reset")
	}
}

func TestMultipleToolUses_IndependentTracking(t *testing.T) {
	// Test that multiple tool_uses can be tracked independently
	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Track multiple tool_uses
	toolIDs := []string{"toolu_a", "toolu_b", "toolu_c"}
	for _, id := range toolIDs {
		handle.conversationMu.Lock()
		handle.pendingToolUses[id] = ToolUseBlock{
			ID:   id,
			Name: "AskUserQuestion",
		}
		handle.conversationMu.Unlock()
	}

	// Verify all are tracked
	handle.conversationMu.Lock()
	if len(handle.pendingToolUses) != 3 {
		t.Errorf("Expected 3 tracked tool_uses, got %d", len(handle.pendingToolUses))
	}
	handle.conversationMu.Unlock()

	// Send tool_result for middle one
	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()
	handle.stdin = writer

	err := handle.SendToolResult("toolu_b", "Answer")
	if err != nil {
		t.Errorf("Failed to send tool_result: %v", err)
	}

	// Verify only the sent one was removed
	handle.conversationMu.Lock()
	if len(handle.pendingToolUses) != 2 {
		t.Errorf("Expected 2 remaining tool_uses, got %d", len(handle.pendingToolUses))
	}
	if _, exists := handle.pendingToolUses["toolu_a"]; !exists {
		t.Error("Expected toolu_a to still be tracked")
	}
	if _, exists := handle.pendingToolUses["toolu_c"]; !exists {
		t.Error("Expected toolu_c to still be tracked")
	}
	if _, exists := handle.pendingToolUses["toolu_b"]; exists {
		t.Error("Expected toolu_b to be removed")
	}
	handle.conversationMu.Unlock()
}

func TestConcurrentToolUseTracking(t *testing.T) {
	// Test concurrent access to pendingToolUses map
	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Concurrently add tool_uses
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			toolID := "toolu_" + string(rune('a'+id))
			handle.conversationMu.Lock()
			handle.pendingToolUses[toolID] = ToolUseBlock{
				ID:   toolID,
				Name: "AskUserQuestion",
			}
			handle.conversationMu.Unlock()
		}(i)
	}
	wg.Wait()

	// Verify all were added
	handle.conversationMu.Lock()
	count := len(handle.pendingToolUses)
	handle.conversationMu.Unlock()

	if count != 10 {
		t.Errorf("Expected 10 tool_uses tracked, got %d", count)
	}
}

// Helper function to create a mock pipe for stdin
func createMockPipe(t *testing.T) (*mockReadCloser, *mockWriteCloser) {
	reader := &mockReadCloser{data: make([]byte, 0)}
	writer := &mockWriteCloser{target: reader}
	return reader, writer
}

type mockReadCloser struct {
	data []byte
	pos  int
}

func (m *mockReadCloser) Read(p []byte) (n int, err error) {
	// Simple implementation for testing
	return 0, nil
}

func (m *mockReadCloser) Close() error {
	return nil
}

type mockWriteCloser struct {
	target *mockReadCloser
}

func (m *mockWriteCloser) Write(p []byte) (n int, err error) {
	// Just track that write was called
	m.target.data = append(m.target.data, p...)
	return len(p), nil
}

func (m *mockWriteCloser) Close() error {
	return nil
}

func TestAskUserQuestion_SetsNeedsRestart(t *testing.T) {
	// Test that AskUserQuestion sets needsRestart flag for kill/restart approach
	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
		mu:              sync.Mutex{},
	}

	// Simulate assistant message with AskUserQuestion
	assistantMsg := map[string]interface{}{
		"type": "assistant",
		"message": map[string]interface{}{
			"role": "assistant",
			"content": []interface{}{
				map[string]interface{}{
					"type": "tool_use",
					"id":   "toolu_restart_test",
					"name": "AskUserQuestion",
					"input": map[string]interface{}{
						"questions": []interface{}{
							map[string]interface{}{
								"question":    "Should we restart?",
								"header":      "RestartTest",
								"multiSelect": false,
								"options": []interface{}{
									map[string]interface{}{
										"label":       "Yes",
										"description": "Restart the process",
									},
									map[string]interface{}{
										"label":       "No",
										"description": "Continue without restart",
									},
								},
							},
						},
					},
				},
			},
		},
	}

	msgJSON, _ := json.Marshal(assistantMsg)
	parseNDJSONLine(string(msgJSON), handle)

	// Verify needsRestart is true
	if !handle.NeedsRestart() {
		t.Error("Expected needsRestart to be true after AskUserQuestion")
	}

	// Verify pendingQuestion is set
	handle.conversationMu.Lock()
	if handle.pendingQuestion == nil {
		t.Error("Expected pendingQuestion to be set")
	}
	if handle.pendingQuestionText != "Should we restart?" {
		t.Errorf("Expected pendingQuestionText='Should we restart?', got '%s'", handle.pendingQuestionText)
	}
	handle.conversationMu.Unlock()

	// Verify tool_use was tracked
	handle.conversationMu.Lock()
	toolUse, exists := handle.pendingToolUses["toolu_restart_test"]
	handle.conversationMu.Unlock()
	if !exists {
		t.Error("Expected tool_use to be tracked")
	}
	if toolUse.Name != "AskUserQuestion" {
		t.Errorf("Expected tool name AskUserQuestion, got %s", toolUse.Name)
	}
}

func TestAskUserQuestion_ClearPendingQuestion(t *testing.T) {
	// Test that ClearPendingQuestion resets the restart state
	handle := &ProcessHandle{
		needsRestart:        true,
		pendingQuestion:     &QuestionData{Question: "test"},
		pendingQuestionText: "test question",
		conversationMu:      sync.Mutex{},
	}

	handle.ClearPendingQuestion()

	if handle.NeedsRestart() {
		t.Error("Expected needsRestart to be false after ClearPendingQuestion")
	}

	handle.conversationMu.Lock()
	if handle.pendingQuestion != nil {
		t.Error("Expected pendingQuestion to be nil after ClearPendingQuestion")
	}
	if handle.pendingQuestionText != "" {
		t.Error("Expected pendingQuestionText to be empty after ClearPendingQuestion")
	}
	handle.conversationMu.Unlock()
}

func TestAskUserQuestion_NoDuplicateRestartFlag(t *testing.T) {
	// Test that duplicate questions don't set needsRestart multiple times
	handle := &ProcessHandle{
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
		mu:              sync.Mutex{},
	}

	// First question
	assistantMsg1 := map[string]interface{}{
		"type": "assistant",
		"message": map[string]interface{}{
			"role": "assistant",
			"content": []interface{}{
				map[string]interface{}{
					"type": "tool_use",
					"id":   "toolu_first",
					"name": "AskUserQuestion",
					"input": map[string]interface{}{
						"questions": []interface{}{
							map[string]interface{}{
								"question":    "First question?",
								"header":      "First",
								"multiSelect": false,
								"options": []interface{}{
									map[string]interface{}{
										"label":       "Yes",
										"description": "Yes",
									},
								},
							},
						},
					},
				},
			},
		},
	}

	msgJSON1, _ := json.Marshal(assistantMsg1)
	parseNDJSONLine(string(msgJSON1), handle)

	// Verify first question set the flag
	if !handle.NeedsRestart() {
		t.Error("Expected needsRestart to be true after first question")
	}

	// Second question (duplicate/follow-up) - should be skipped
	assistantMsg2 := map[string]interface{}{
		"type": "assistant",
		"message": map[string]interface{}{
			"role": "assistant",
			"content": []interface{}{
				map[string]interface{}{
					"type": "tool_use",
					"id":   "toolu_second",
					"name": "AskUserQuestion",
					"input": map[string]interface{}{
						"questions": []interface{}{
							map[string]interface{}{
								"question":    "Second question?",
								"header":      "Second",
								"multiSelect": false,
								"options": []interface{}{
									map[string]interface{}{
										"label":       "Yes",
										"description": "Yes",
									},
								},
							},
						},
					},
				},
			},
		},
	}

	msgJSON2, _ := json.Marshal(assistantMsg2)
	outputs := parseNDJSONLine(string(msgJSON2), handle)

	// Verify second question was skipped (no question in outputs)
	foundQuestion := false
	for _, output := range outputs {
		if output.Type == "question" {
			foundQuestion = true
		}
	}
	if foundQuestion {
		t.Error("Expected duplicate question to be skipped, but it was emitted")
	}

	// Verify restart flag is still true (not reset by duplicate)
	if !handle.NeedsRestart() {
		t.Error("Expected needsRestart to remain true")
	}
}
