package process

import (
	"sync"
	"time"
)

// SubagentStatus represents the lifecycle state of a sub-agent
type SubagentStatus string

const (
	SubagentRunning   SubagentStatus = "running"
	SubagentCompleted SubagentStatus = "completed"
	SubagentError     SubagentStatus = "error"
)

// SubagentTrace represents a hierarchical trace of Task tool invocations
type SubagentTrace struct {
	ID          string           // tool_use_id from the Task invocation
	ParentID    string           // ID of parent trace (empty for root)
	Description string           // Short description of what the agent is doing
	Type        string           // subagent_type (e.g., "Explore", "Bash", "Plan")
	Prompt      string           // Full prompt text (optional, may be large)
	Model       string           // Model used (e.g., "haiku", "sonnet")
	Status      SubagentStatus   // Current status
	StartTime   time.Time        // When the task was invoked
	EndTime     time.Time        // When the task completed (zero if still running)
	Error       string           // Error message if status is error
	Children    []*SubagentTrace // Child traces (nested Task invocations)
	mu          sync.RWMutex     // Protects mutable fields
}

// SubagentTraceParser tracks active Task tool invocations and builds a hierarchy
type SubagentTraceParser struct {
	activeStack []*SubagentTrace       // Stack of currently executing traces
	allTraces   map[string]*SubagentTrace // Map of all traces by ID
	mu          sync.Mutex              // Protects parser state
}

// NewSubagentTraceParser creates a new trace parser
func NewSubagentTraceParser() *SubagentTraceParser {
	return &SubagentTraceParser{
		activeStack: make([]*SubagentTrace, 0),
		allTraces:   make(map[string]*SubagentTrace),
	}
}

// OnTaskToolUse is called when a Task tool_use block is detected
func (p *SubagentTraceParser) OnTaskToolUse(toolUseID string, params map[string]interface{}) *SubagentTrace {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Extract parameters
	subagentType, _ := params["subagent_type"].(string)
	description, _ := params["description"].(string)
	prompt, _ := params["prompt"].(string)
	model, _ := params["model"].(string)

	// Determine parent (top of stack)
	var parentID string
	if len(p.activeStack) > 0 {
		parentID = p.activeStack[len(p.activeStack)-1].ID
	}

	// Create trace
	trace := &SubagentTrace{
		ID:          toolUseID,
		ParentID:    parentID,
		Description: description,
		Type:        subagentType,
		Prompt:      prompt,
		Model:       model,
		Status:      SubagentRunning,
		StartTime:   time.Now(),
		Children:    make([]*SubagentTrace, 0),
	}

	// Store in map
	p.allTraces[toolUseID] = trace

	// Add as child to parent if exists
	if parentID != "" {
		if parent, ok := p.allTraces[parentID]; ok {
			parent.mu.Lock()
			parent.Children = append(parent.Children, trace)
			parent.mu.Unlock()
		}
	}

	// Push to active stack
	p.activeStack = append(p.activeStack, trace)

	return trace
}

// OnTaskToolResult is called when a Task tool_result block is detected
func (p *SubagentTraceParser) OnTaskToolResult(toolUseID string, success bool, errorMsg string) *SubagentTrace {
	p.mu.Lock()
	defer p.mu.Unlock()

	trace, ok := p.allTraces[toolUseID]
	if !ok {
		// Trace not found - this shouldn't happen but handle gracefully
		return nil
	}

	// Update trace status
	trace.mu.Lock()
	trace.EndTime = time.Now()
	if success {
		trace.Status = SubagentCompleted
	} else {
		trace.Status = SubagentError
		trace.Error = errorMsg
	}
	trace.mu.Unlock()

	// Pop from active stack if it's on top
	if len(p.activeStack) > 0 && p.activeStack[len(p.activeStack)-1].ID == toolUseID {
		p.activeStack = p.activeStack[:len(p.activeStack)-1]
	}

	return trace
}

// GetActiveTraces returns the current stack of active traces (root to leaf)
func (p *SubagentTraceParser) GetActiveTraces() []*SubagentTrace {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Return a copy to avoid concurrent access issues
	result := make([]*SubagentTrace, len(p.activeStack))
	copy(result, p.activeStack)
	return result
}

// GetAllTraces returns all traces (completed and active)
func (p *SubagentTraceParser) GetAllTraces() []*SubagentTrace {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Return root traces (traces without parents)
	roots := make([]*SubagentTrace, 0)
	for _, trace := range p.allTraces {
		if trace.ParentID == "" {
			roots = append(roots, trace)
		}
	}
	return roots
}

// GetTrace retrieves a specific trace by ID
func (p *SubagentTraceParser) GetTrace(toolUseID string) *SubagentTrace {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.allTraces[toolUseID]
}

// Duration returns the duration of the trace (EndTime - StartTime)
// Returns 0 if the trace is still running
func (t *SubagentTrace) Duration() time.Duration {
	t.mu.RLock()
	defer t.mu.RUnlock()

	if t.EndTime.IsZero() {
		return 0
	}
	return t.EndTime.Sub(t.StartTime)
}

// IsRunning returns true if the trace is still active
func (t *SubagentTrace) IsRunning() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()

	return t.Status == SubagentRunning
}
