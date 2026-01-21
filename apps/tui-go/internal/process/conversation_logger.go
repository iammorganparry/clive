package process

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ConversationLogger captures all NDJSON events to a file for debugging
type ConversationLogger struct {
	file      *os.File
	mu        sync.Mutex
	eventSeq  int
	iteration int
	epicID    string
	startTime time.Time
}

// ConversationEvent represents a logged event
type ConversationEvent struct {
	Timestamp string                 `json:"timestamp"`
	Iteration int                    `json:"iteration,omitempty"`
	EventSeq  int                    `json:"event_seq"`
	EventType string                 `json:"event_type"`
	Direction string                 `json:"direction"` // "stdout" or "stdin"
	Raw       map[string]interface{} `json:"raw,omitempty"`
	Parsed    interface{}            `json:"parsed,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// NewConversationLogger creates a logger for a conversation session
func NewConversationLogger(epicID string, iteration int, mode string) (*ConversationLogger, error) {
	// Determine log file path based on mode and epic
	// IMPORTANT: Use global directory to avoid committing logs to git
	var logPath string
	timestamp := time.Now().Format("20060102-150405")

	// Get home directory for global logs
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	// Get current working directory basename for project identification
	cwd, err := os.Getwd()
	if err != nil {
		cwd = "unknown"
	}
	projectName := filepath.Base(cwd)

	// Base log directory: ~/.clive/logs/{project-name}/
	baseLogDir := filepath.Join(homeDir, ".clive", "logs", projectName)

	if mode == "build" && epicID != "" {
		// Build mode with epic: ~/.clive/logs/{project}/epics/{epicID}/conversation-build-{iteration}-{timestamp}.ndjson
		epicDir := filepath.Join(baseLogDir, "epics", epicID)
		if err := os.MkdirAll(epicDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create epic directory: %w", err)
		}
		logPath = filepath.Join(epicDir, fmt.Sprintf("conversation-build-%d-%s.ndjson", iteration, timestamp))
	} else if mode == "plan" {
		// Plan mode: ~/.clive/logs/{project}/conversation-plan-{timestamp}.ndjson
		if err := os.MkdirAll(baseLogDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create log directory: %w", err)
		}
		logPath = filepath.Join(baseLogDir, fmt.Sprintf("conversation-plan-%s.ndjson", timestamp))
	} else if mode == "question" {
		// Question test mode: ~/.clive/logs/{project}/conversation-question-{timestamp}.ndjson
		if err := os.MkdirAll(baseLogDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create log directory: %w", err)
		}
		logPath = filepath.Join(baseLogDir, fmt.Sprintf("conversation-question-%s.ndjson", timestamp))
	} else {
		// Fallback for build mode without epic
		if err := os.MkdirAll(baseLogDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create log directory: %w", err)
		}
		logPath = filepath.Join(baseLogDir, fmt.Sprintf("conversation-build-%d-%s.ndjson", iteration, timestamp))
	}

	// Open file for writing
	file, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create conversation log file: %w", err)
	}

	logger := &ConversationLogger{
		file:      file,
		eventSeq:  0,
		iteration: iteration,
		epicID:    epicID,
		startTime: time.Now(),
	}

	// Write metadata header as first line for easier debugging
	metadata := map[string]interface{}{
		"type":       "iteration_metadata",
		"iteration":  iteration,
		"epic_id":    epicID,
		"mode":       mode,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"log_path":   logPath,
		"project":    projectName,
	}
	headerData, err := json.Marshal(metadata)
	if err == nil {
		file.Write(append(headerData, '\n'))
		file.Sync()
	}

	return logger, nil
}

// LogNDJSONEvent logs a raw NDJSON line from Claude CLI
func (cl *ConversationLogger) LogNDJSONEvent(rawLine string, parsedOutput *OutputLine) {
	if cl == nil {
		return
	}

	cl.mu.Lock()
	defer cl.mu.Unlock()

	cl.eventSeq++

	// Parse raw JSON to extract event type
	var rawData map[string]interface{}
	eventType := "unknown"
	if err := json.Unmarshal([]byte(rawLine), &rawData); err == nil {
		if t, ok := rawData["type"].(string); ok {
			eventType = t
		}
	} else {
		// Not JSON - treat as raw stdout
		eventType = "stdout"
		rawData = map[string]interface{}{"text": rawLine}
	}

	// Create conversation event
	event := ConversationEvent{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Iteration: cl.iteration,
		EventSeq:  cl.eventSeq,
		EventType: eventType,
		Direction: "stdout",
		Raw:       rawData,
	}

	// Add parsed output if available
	if parsedOutput != nil {
		event.Parsed = map[string]interface{}{
			"type":       parsedOutput.Type,
			"text":       parsedOutput.Text,
			"tool_name":  parsedOutput.ToolName,
			"debug_info": parsedOutput.DebugInfo,
		}
	}

	// Write as NDJSON line
	data, err := json.Marshal(event)
	if err != nil {
		return // Silently skip if marshal fails
	}

	cl.file.Write(append(data, '\n'))
	cl.file.Sync() // Flush immediately for debugging
}

// LogSentMessage logs a message sent TO Claude CLI via stdin
func (cl *ConversationLogger) LogSentMessage(msgType string, message interface{}, metadata map[string]interface{}) {
	if cl == nil {
		return
	}

	cl.mu.Lock()
	defer cl.mu.Unlock()

	cl.eventSeq++

	// Convert message to map for JSON encoding
	var rawData map[string]interface{}
	if msgMap, ok := message.(map[string]interface{}); ok {
		rawData = msgMap
	} else {
		// Fallback: try to marshal and unmarshal
		data, _ := json.Marshal(message)
		json.Unmarshal(data, &rawData)
	}

	// Create conversation event
	event := ConversationEvent{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Iteration: cl.iteration,
		EventSeq:  cl.eventSeq,
		EventType: msgType,
		Direction: "stdin",
		Raw:       rawData,
		Metadata:  metadata,
	}

	// Write as NDJSON line
	data, err := json.Marshal(event)
	if err != nil {
		return // Silently skip if marshal fails
	}

	cl.file.Write(append(data, '\n'))
	cl.file.Sync() // Flush immediately for debugging
}

// LogSubagentTrace logs a sub-agent trace event for post-mortem analysis
func (cl *ConversationLogger) LogSubagentTrace(trace *SubagentTrace) {
	if cl == nil || trace == nil {
		return
	}

	cl.mu.Lock()
	defer cl.mu.Unlock()

	cl.eventSeq++

	// Create trace event with all relevant information
	event := ConversationEvent{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Iteration: cl.iteration,
		EventSeq:  cl.eventSeq,
		EventType: "subagent_trace",
		Direction: "internal",
		Parsed: map[string]interface{}{
			"trace_id":    trace.ID,
			"parent_id":   trace.ParentID,
			"agent_type":  trace.Type,
			"description": trace.Description,
			"model":       trace.Model,
			"status":      string(trace.Status),
			"start_time":  trace.StartTime.UTC().Format(time.RFC3339Nano),
			"end_time":    trace.EndTime.UTC().Format(time.RFC3339Nano),
			"duration_ms": trace.Duration().Milliseconds(),
			"error":       trace.Error,
		},
	}

	// Write as NDJSON line
	data, err := json.Marshal(event)
	if err != nil {
		return // Silently skip if marshal fails
	}

	cl.file.Write(append(data, '\n'))
	cl.file.Sync() // Flush immediately for debugging
}

// Close closes the log file
func (cl *ConversationLogger) Close() error {
	if cl == nil || cl.file == nil {
		return nil
	}

	cl.mu.Lock()
	defer cl.mu.Unlock()

	return cl.file.Close()
}
