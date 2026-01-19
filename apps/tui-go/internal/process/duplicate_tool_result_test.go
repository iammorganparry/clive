package process

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// TestSendToolResult_PreventsDuplicateSends verifies we can't send the same tool_result twice
func TestSendToolResult_PreventsDuplicateSends(t *testing.T) {
	// Reset state
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Track tool_use
	toolID := "toolu_duplicate_test"
	handle.conversationMu.Lock()
	handle.pendingToolUses[toolID] = ToolUseBlock{
		ID:   toolID,
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// First send should succeed
	err1 := handle.SendToolResult(toolID, "First answer")
	if err1 != nil {
		t.Fatalf("First SendToolResult should succeed, got: %v", err1)
	}

	// Second send with same ID should fail (already cleaned up)
	err2 := handle.SendToolResult(toolID, "Second answer")
	if err2 == nil {
		t.Error("Second SendToolResult with same ID should fail, but succeeded")
	}
	if !strings.Contains(err2.Error(), "not found in conversation") {
		t.Errorf("Expected 'not found' error, got: %v", err2)
	}
}

// TestSendToolResult_ConcurrentCallsSameID tests race condition prevention
func TestSendToolResult_ConcurrentCallsSameID(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	toolID := "toolu_concurrent_test"
	handle.conversationMu.Lock()
	handle.pendingToolUses[toolID] = ToolUseBlock{
		ID:   toolID,
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// Try to send from multiple goroutines concurrently
	results := make(chan error, 3)
	for i := 0; i < 3; i++ {
		go func(id int) {
			err := handle.SendToolResult(toolID, "Concurrent answer")
			results <- err
		}(i)
	}

	// Collect results
	var successCount, failCount int
	for i := 0; i < 3; i++ {
		err := <-results
		if err == nil {
			successCount++
		} else {
			failCount++
		}
	}

	// Only ONE should succeed
	if successCount != 1 {
		t.Errorf("Expected exactly 1 successful send, got %d", successCount)
	}
	if failCount != 2 {
		t.Errorf("Expected exactly 2 failed sends, got %d", failCount)
	}
}

// TestSendToolResult_MultipleQuestionsSeparateIDs tests that different questions work independently
func TestSendToolResult_MultipleQuestionsSeparateIDs(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Track multiple questions
	tool1 := "toolu_q1"
	tool2 := "toolu_q2"
	tool3 := "toolu_q3"

	handle.conversationMu.Lock()
	handle.pendingToolUses[tool1] = ToolUseBlock{ID: tool1, Name: "AskUserQuestion"}
	handle.pendingToolUses[tool2] = ToolUseBlock{ID: tool2, Name: "AskUserQuestion"}
	handle.pendingToolUses[tool3] = ToolUseBlock{ID: tool3, Name: "AskUserQuestion"}
	handle.conversationMu.Unlock()

	// Answer in different order
	err1 := handle.SendToolResult(tool2, "Answer 2")
	if err1 != nil {
		t.Errorf("Answer to Q2 should succeed: %v", err1)
	}

	err2 := handle.SendToolResult(tool1, "Answer 1")
	if err2 != nil {
		t.Errorf("Answer to Q1 should succeed: %v", err2)
	}

	err3 := handle.SendToolResult(tool3, "Answer 3")
	if err3 != nil {
		t.Errorf("Answer to Q3 should succeed: %v", err3)
	}

	// All should be cleaned up
	handle.conversationMu.Lock()
	remaining := len(handle.pendingToolUses)
	handle.conversationMu.Unlock()

	if remaining != 0 {
		t.Errorf("Expected all tool_uses to be cleaned up, but %d remain", remaining)
	}
}

// TestSendToolResult_RapidFirePrevention simulates user pressing Enter rapidly
func TestSendToolResult_RapidFirePrevention(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	toolID := "toolu_rapid_fire"
	handle.conversationMu.Lock()
	handle.pendingToolUses[toolID] = ToolUseBlock{
		ID:   toolID,
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// Simulate rapid Enter presses (within 50ms)
	results := make(chan error, 5)
	for i := 0; i < 5; i++ {
		go func() {
			err := handle.SendToolResult(toolID, "Rapid answer")
			results <- err
		}()
		time.Sleep(10 * time.Millisecond)
	}

	// Collect results
	var successCount int
	for i := 0; i < 5; i++ {
		err := <-results
		if err == nil {
			successCount++
		}
	}

	// Only ONE should succeed despite rapid presses
	if successCount != 1 {
		t.Errorf("Expected exactly 1 successful send from rapid presses, got %d", successCount)
	}
}

// TestSendToolResult_MessageFormat verifies we send exactly ONE tool_result block
func TestSendToolResult_MessageFormat(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	toolID := "toolu_format_test"
	handle.conversationMu.Lock()
	handle.pendingToolUses[toolID] = ToolUseBlock{
		ID:   toolID,
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// Send tool result
	err := handle.SendToolResult(toolID, "Test answer")
	if err != nil {
		t.Fatalf("SendToolResult failed: %v", err)
	}

	// Parse what was written to stdin
	writtenData := writer.target.data
	if len(writtenData) == 0 {
		t.Fatal("No data written to stdin")
	}

	// Verify JSON structure (manually check since we can't easily parse here)
	jsonStr := string(writtenData)

	// Should have exactly one "tool_result" type
	toolResultCount := strings.Count(jsonStr, `"type":"tool_result"`)
	if toolResultCount != 1 {
		t.Errorf("Expected exactly 1 tool_result in message, found %d", toolResultCount)
	}

	// Should have exactly one tool_use_id field
	toolUseIDCount := strings.Count(jsonStr, `"tool_use_id":`)
	if toolUseIDCount != 1 {
		t.Errorf("Expected exactly 1 tool_use_id field, found %d", toolUseIDCount)
	}

	// Content array should appear once
	contentArrayCount := strings.Count(jsonStr, `"content":[`)
	if contentArrayCount != 1 {
		t.Errorf("Expected exactly 1 content array, found %d", contentArrayCount)
	}
}

// TestSendToolResult_NoOrphanedCleanup verifies cleanup happens on success AND failure
func TestSendToolResult_NoOrphanedCleanup(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	toolID := "toolu_cleanup_test"
	handle.conversationMu.Lock()
	handle.pendingToolUses[toolID] = ToolUseBlock{
		ID:   toolID,
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// Send successfully
	err := handle.SendToolResult(toolID, "Answer")
	if err != nil {
		t.Fatalf("SendToolResult should succeed: %v", err)
	}

	// Verify cleanup happened
	handle.conversationMu.Lock()
	_, exists := handle.pendingToolUses[toolID]
	handle.conversationMu.Unlock()

	if exists {
		t.Error("tool_use should be removed after successful send")
	}
}

// TestSendToolResult_StaleIDValidation verifies we reject stale IDs
func TestSendToolResult_StaleIDValidation(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	// Try to send without tracking
	err := handle.SendToolResult("toolu_never_tracked", "Answer")
	if err == nil {
		t.Error("Should reject tool_use_id that was never tracked")
	}
	if !strings.Contains(err.Error(), "not found in conversation") {
		t.Errorf("Expected 'not found' error, got: %v", err)
	}
}

// TestSendToolResult_ConcurrentStdinWrites verifies only ONE message written to stdin during race
func TestSendToolResult_ConcurrentStdinWrites(t *testing.T) {
	ResetStreamingState()

	reader, writer := createMockPipe(t)
	defer reader.Close()
	defer writer.Close()

	handle := &ProcessHandle{
		stdin:           writer,
		pendingToolUses: make(map[string]ToolUseBlock),
		conversationMu:  sync.Mutex{},
	}

	toolID := "toolu_stdin_race_test"
	handle.conversationMu.Lock()
	handle.pendingToolUses[toolID] = ToolUseBlock{
		ID:   toolID,
		Name: "AskUserQuestion",
	}
	handle.conversationMu.Unlock()

	// Launch multiple goroutines trying to send concurrently
	numThreads := 5
	results := make(chan error, numThreads)
	start := make(chan struct{})

	for i := 0; i < numThreads; i++ {
		go func() {
			<-start // Wait for all goroutines to be ready
			err := handle.SendToolResult(toolID, "Concurrent answer")
			results <- err
		}()
	}

	// Start all goroutines at once to maximize race condition chance
	close(start)

	// Wait for all to complete
	for i := 0; i < numThreads; i++ {
		<-results
	}

	// Give a moment for any buffered writes to complete
	time.Sleep(10 * time.Millisecond)

	// Parse stdin data to count actual messages written
	writtenData := writer.target.data
	if len(writtenData) == 0 {
		t.Fatal("No data written to stdin")
	}

	dataStr := string(writtenData)

	// Count messages containing our specific tool_use_id
	// Each message is a JSON line ending with \n
	lines := strings.Split(strings.TrimSpace(dataStr), "\n")

	var messagesWithToolID int
	for _, line := range lines {
		if strings.Contains(line, toolID) {
			// Verify it's actually a tool_result message
			if strings.Contains(line, `"type":"tool_result"`) {
				messagesWithToolID++
			}
		}
	}

	// CRITICAL: Only ONE tool_result message should be written to stdin
	if messagesWithToolID != 1 {
		t.Errorf("Race condition not prevented! Expected exactly 1 tool_result message written to stdin, got %d", messagesWithToolID)
		t.Logf("Written data:\n%s", dataStr)
	}

	// Verify message format is correct
	if !strings.Contains(dataStr, `"tool_use_id":"`+toolID+`"`) {
		t.Error("Message missing tool_use_id field")
	}
	if !strings.Contains(dataStr, `"type":"tool_result"`) {
		t.Error("Message missing type:tool_result")
	}
}
