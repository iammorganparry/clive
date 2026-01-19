package process

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewConversationLogger_BuildModeWithEpic(t *testing.T) {
	// Create temporary directory for test
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	// Test: Build mode with epic ID
	logger, err := NewConversationLogger("epic-123", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Verify file was created
	expectedPath := filepath.Join(".claude", "epics", "epic-123", "conversation-build-1-*.ndjson")
	matches, err := filepath.Glob(expectedPath)
	if err != nil {
		t.Fatalf("Glob failed: %v", err)
	}
	if len(matches) == 0 {
		t.Errorf("Expected log file matching %s, but none found", expectedPath)
	}

	// Verify logger fields
	if logger.epicID != "epic-123" {
		t.Errorf("Expected epicID=epic-123, got %s", logger.epicID)
	}
	if logger.iteration != 1 {
		t.Errorf("Expected iteration=1, got %d", logger.iteration)
	}
}

func TestNewConversationLogger_PlanMode(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	// Test: Plan mode (no epic)
	logger, err := NewConversationLogger("", 0, "plan")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Verify file was created
	expectedPath := filepath.Join(".claude", "conversation-plan-*.ndjson")
	matches, err := filepath.Glob(expectedPath)
	if err != nil {
		t.Fatalf("Glob failed: %v", err)
	}
	if len(matches) == 0 {
		t.Errorf("Expected log file matching %s, but none found", expectedPath)
	}
}

func TestNewConversationLogger_BuildModeWithoutEpic(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	// Test: Build mode without epic (fallback)
	logger, err := NewConversationLogger("", 2, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Verify file was created in .claude/ root
	expectedPath := filepath.Join(".claude", "conversation-build-2-*.ndjson")
	matches, err := filepath.Glob(expectedPath)
	if err != nil {
		t.Fatalf("Glob failed: %v", err)
	}
	if len(matches) == 0 {
		t.Errorf("Expected log file matching %s, but none found", expectedPath)
	}
}

func TestLogNDJSONEvent_ValidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Log a valid NDJSON event
	rawLine := `{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}`
	output := &OutputLine{
		Type:      "assistant",
		Text:      "Hello",
		DebugInfo: "[content_block_delta] text_delta",
	}
	logger.LogNDJSONEvent(rawLine, output)

	// Force flush and read back
	logger.file.Sync()
	logger.file.Seek(0, 0)

	var event ConversationEvent
	decoder := json.NewDecoder(logger.file)
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("Failed to decode logged event: %v", err)
	}

	// Verify event fields
	if event.EventType != "content_block_delta" {
		t.Errorf("Expected event_type=content_block_delta, got %s", event.EventType)
	}
	if event.Direction != "stdout" {
		t.Errorf("Expected direction=stdout, got %s", event.Direction)
	}
	if event.EventSeq != 1 {
		t.Errorf("Expected event_seq=1, got %d", event.EventSeq)
	}
	if event.Iteration != 1 {
		t.Errorf("Expected iteration=1, got %d", event.Iteration)
	}

	// Verify parsed data
	parsed, ok := event.Parsed.(map[string]interface{})
	if !ok {
		t.Fatal("Parsed field is not a map")
	}
	if parsed["type"] != "assistant" {
		t.Errorf("Expected parsed.type=assistant, got %v", parsed["type"])
	}
	if parsed["text"] != "Hello" {
		t.Errorf("Expected parsed.text=Hello, got %v", parsed["text"])
	}
}

func TestLogNDJSONEvent_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Log non-JSON (raw stdout)
	rawLine := "Some plain text output\n"
	output := &OutputLine{
		Type: "stdout",
		Text: rawLine,
	}
	logger.LogNDJSONEvent(rawLine, output)

	// Force flush and read back
	logger.file.Sync()
	logger.file.Seek(0, 0)

	var event ConversationEvent
	decoder := json.NewDecoder(logger.file)
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("Failed to decode logged event: %v", err)
	}

	// Verify it's treated as stdout
	if event.EventType != "stdout" {
		t.Errorf("Expected event_type=stdout, got %s", event.EventType)
	}
	if event.Raw["text"] != rawLine {
		t.Errorf("Expected raw.text=%s, got %v", rawLine, event.Raw["text"])
	}
}

func TestLogNDJSONEvent_NilOutput(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Log with nil output
	rawLine := `{"type":"ping"}`
	logger.LogNDJSONEvent(rawLine, nil)

	// Verify it doesn't crash and logs successfully
	logger.file.Sync()
	logger.file.Seek(0, 0)

	var event ConversationEvent
	decoder := json.NewDecoder(logger.file)
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("Failed to decode logged event: %v", err)
	}

	// Parsed should be nil or empty
	if event.Parsed != nil {
		t.Errorf("Expected nil parsed for nil output, got %v", event.Parsed)
	}
}

func TestLogSentMessage_ToolResult(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Log a tool_result message
	msg := map[string]interface{}{
		"type": "user",
		"message": map[string]interface{}{
			"role": "user",
			"content": []map[string]interface{}{
				{
					"type":        "tool_result",
					"tool_use_id": "toolu_123",
					"content":     "Answer text",
				},
			},
		},
	}
	metadata := map[string]interface{}{
		"tool_use_id":   "toolu_123",
		"validation":    "exists",
		"pending_count": 2,
	}

	logger.LogSentMessage("tool_result", msg, metadata)

	// Force flush and read back
	logger.file.Sync()
	logger.file.Seek(0, 0)

	var event ConversationEvent
	decoder := json.NewDecoder(logger.file)
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("Failed to decode logged event: %v", err)
	}

	// Verify event fields
	if event.EventType != "tool_result" {
		t.Errorf("Expected event_type=tool_result, got %s", event.EventType)
	}
	if event.Direction != "stdin" {
		t.Errorf("Expected direction=stdin, got %s", event.Direction)
	}
	if event.Metadata["tool_use_id"] != "toolu_123" {
		t.Errorf("Expected metadata.tool_use_id=toolu_123, got %v", event.Metadata["tool_use_id"])
	}
	if event.Metadata["validation"] != "exists" {
		t.Errorf("Expected metadata.validation=exists, got %v", event.Metadata["validation"])
	}
}

func TestLogSentMessage_UserMessage(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Log a regular user message
	msg := map[string]interface{}{
		"type": "user",
		"message": map[string]string{
			"role":    "user",
			"content": "Hello Claude",
		},
	}

	logger.LogSentMessage("user_message", msg, nil)

	// Force flush and read back
	logger.file.Sync()
	logger.file.Seek(0, 0)

	var event ConversationEvent
	decoder := json.NewDecoder(logger.file)
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("Failed to decode logged event: %v", err)
	}

	// Verify event fields
	if event.EventType != "user_message" {
		t.Errorf("Expected event_type=user_message, got %s", event.EventType)
	}
	if event.Direction != "stdin" {
		t.Errorf("Expected direction=stdin, got %s", event.Direction)
	}
}

func TestEventSequenceIncrementing(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Log multiple events
	for i := 0; i < 5; i++ {
		logger.LogNDJSONEvent(`{"type":"ping"}`, nil)
	}

	// Read back all events
	logger.file.Sync()
	logger.file.Seek(0, 0)

	decoder := json.NewDecoder(logger.file)
	for expectedSeq := 1; expectedSeq <= 5; expectedSeq++ {
		var event ConversationEvent
		if err := decoder.Decode(&event); err != nil {
			t.Fatalf("Failed to decode event %d: %v", expectedSeq, err)
		}
		if event.EventSeq != expectedSeq {
			t.Errorf("Expected event_seq=%d, got %d", expectedSeq, event.EventSeq)
		}
	}
}

func TestConcurrentLogging(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	// Log concurrently from multiple goroutines
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 10; j++ {
				logger.LogNDJSONEvent(`{"type":"test"}`, &OutputLine{Type: "test"})
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify we have exactly 100 events
	logger.file.Sync()
	logger.file.Seek(0, 0)

	count := 0
	decoder := json.NewDecoder(logger.file)
	for {
		var event ConversationEvent
		if err := decoder.Decode(&event); err != nil {
			break
		}
		count++
	}

	if count != 100 {
		t.Errorf("Expected 100 events, got %d", count)
	}
}

func TestNilLogger_DoesNotCrash(t *testing.T) {
	// Test that nil logger doesn't crash
	var logger *ConversationLogger = nil

	// These should all be no-ops
	logger.LogNDJSONEvent(`{"type":"test"}`, nil)
	logger.LogSentMessage("test", map[string]interface{}{}, nil)
	err := logger.Close()

	if err != nil {
		t.Errorf("Expected nil error from closing nil logger, got %v", err)
	}
}

func TestTimestampFormat(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	logger, err := NewConversationLogger("test-epic", 1, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Close()

	logger.LogNDJSONEvent(`{"type":"test"}`, nil)

	// Read back and verify timestamp format
	logger.file.Sync()
	logger.file.Seek(0, 0)

	var event ConversationEvent
	decoder := json.NewDecoder(logger.file)
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("Failed to decode event: %v", err)
	}

	// Verify timestamp is RFC3339Nano format and can be parsed
	_, err = time.Parse(time.RFC3339Nano, event.Timestamp)
	if err != nil {
		t.Errorf("Timestamp %s is not valid RFC3339Nano format: %v", event.Timestamp, err)
	}
}

func TestFilePathFormat(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	// Test build mode with epic - should create nested directory
	logger1, err := NewConversationLogger("epic-abc", 3, "build")
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	defer logger1.Close()

	// Check directory structure
	epicDir := filepath.Join(".claude", "epics", "epic-abc")
	if _, err := os.Stat(epicDir); os.IsNotExist(err) {
		t.Errorf("Expected epic directory %s to exist", epicDir)
	}

	// Check filename pattern: conversation-build-3-YYYYMMDD-HHMMSS.ndjson
	pattern := filepath.Join(epicDir, "conversation-build-3-*.ndjson")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("Glob failed: %v", err)
	}
	if len(matches) != 1 {
		t.Errorf("Expected 1 file matching %s, got %d", pattern, len(matches))
	}

	// Verify filename contains timestamp
	if len(matches) > 0 {
		filename := filepath.Base(matches[0])
		if !strings.HasPrefix(filename, "conversation-build-3-") {
			t.Errorf("Filename %s doesn't match expected pattern", filename)
		}
		if !strings.HasSuffix(filename, ".ndjson") {
			t.Errorf("Filename %s doesn't end with .ndjson", filename)
		}
	}
}

func TestCreateConversationLogger_ExtractArgs(t *testing.T) {
	// Test epic and iteration extraction from args
	tests := []struct {
		name              string
		args              []string
		promptType        string
		expectEpicID      string
		expectIteration   int
		expectFilePattern string
	}{
		{
			name:              "Build with epic and iteration",
			args:              []string{"--epic", "test-epic-123", "--iteration", "5", "other", "args"},
			promptType:        "build",
			expectEpicID:      "test-epic-123",
			expectIteration:   5,
			expectFilePattern: ".claude/epics/test-epic-123/conversation-build-5-*.ndjson",
		},
		{
			name:              "Plan mode",
			args:              []string{"some", "args"},
			promptType:        "plan",
			expectEpicID:      "",
			expectIteration:   0,
			expectFilePattern: ".claude/conversation-plan-*.ndjson",
		},
		{
			name:              "Build without epic",
			args:              []string{"--iteration", "2"},
			promptType:        "build",
			expectEpicID:      "",
			expectIteration:   2,
			expectFilePattern: ".claude/conversation-build-2-*.ndjson",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			origDir, _ := os.Getwd()
			defer os.Chdir(origDir)
			os.Chdir(tmpDir)

			logger, err := createConversationLogger(tt.args, tt.promptType)
			if err != nil {
				t.Fatalf("Failed to create logger: %v", err)
			}
			defer logger.Close()

			// Verify epic ID and iteration
			if logger.epicID != tt.expectEpicID {
				t.Errorf("Expected epicID=%s, got %s", tt.expectEpicID, logger.epicID)
			}
			if logger.iteration != tt.expectIteration {
				t.Errorf("Expected iteration=%d, got %d", tt.expectIteration, logger.iteration)
			}

			// Verify file was created
			matches, err := filepath.Glob(tt.expectFilePattern)
			if err != nil {
				t.Fatalf("Glob failed: %v", err)
			}
			if len(matches) == 0 {
				t.Errorf("Expected file matching %s, but none found", tt.expectFilePattern)
			}
		})
	}
}
