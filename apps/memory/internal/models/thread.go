package models

// ThreadStatus represents the lifecycle state of a feature thread.
type ThreadStatus string

const (
	ThreadStatusActive ThreadStatus = "active"
	ThreadStatusPaused ThreadStatus = "paused"
	ThreadStatusClosed ThreadStatus = "closed"
)

func (s ThreadStatus) IsValid() bool {
	return s == ThreadStatusActive || s == ThreadStatusPaused || s == ThreadStatusClosed
}

// ThreadSection categorizes entries within a thread.
type ThreadSection string

const (
	ThreadSectionFindings    ThreadSection = "findings"
	ThreadSectionDecisions   ThreadSection = "decisions"
	ThreadSectionArchitect   ThreadSection = "architecture"
	ThreadSectionTodo        ThreadSection = "todo"
	ThreadSectionContext     ThreadSection = "context"
)

func (s ThreadSection) IsValid() bool {
	switch s {
	case ThreadSectionFindings, ThreadSectionDecisions, ThreadSectionArchitect, ThreadSectionTodo, ThreadSectionContext:
		return true
	}
	return false
}

// FeatureThread is a container for accumulating context across sessions.
type FeatureThread struct {
	ID           string       `json:"id"`
	WorkspaceID  string       `json:"workspaceId"`
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	Status       ThreadStatus `json:"status"`
	CreatedAt    int64        `json:"createdAt"`
	UpdatedAt    int64        `json:"updatedAt"`
	ClosedAt     *int64       `json:"closedAt,omitempty"`
	EntryCount   int          `json:"entryCount"`
	TokenBudget  int          `json:"tokenBudget"`
	Summary      string       `json:"summary"`
	RelatedFiles []string     `json:"relatedFiles,omitempty"`
	Tags         []string     `json:"tags,omitempty"`
}

// ThreadEntry links a memory to a thread with ordering and section info.
type ThreadEntry struct {
	ID        string        `json:"id"`
	ThreadID  string        `json:"threadId"`
	MemoryID  string        `json:"memoryId"`
	Sequence  int           `json:"sequence"`
	Section   ThreadSection `json:"section"`
	CreatedAt int64         `json:"createdAt"`

	// Populated by joins, not stored directly.
	Content    string     `json:"content,omitempty"`
	MemoryType MemoryType `json:"memoryType,omitempty"`
}

// --- Request / Response types ---

// CreateThreadRequest is the payload for POST /threads.
type CreateThreadRequest struct {
	Namespace   string   `json:"-"`
	Workspace   string   `json:"workspace"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	TokenBudget int      `json:"tokenBudget,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// UpdateThreadRequest is the payload for PATCH /threads/{id}.
type UpdateThreadRequest struct {
	Status       *ThreadStatus `json:"status,omitempty"`
	Summary      *string       `json:"summary,omitempty"`
	TokenBudget  *int          `json:"tokenBudget,omitempty"`
	Description  *string       `json:"description,omitempty"`
	RelatedFiles *[]string     `json:"relatedFiles,omitempty"`
	Tags         *[]string     `json:"tags,omitempty"`
}

// AppendEntryRequest is the payload for POST /threads/{id}/entries.
type AppendEntryRequest struct {
	Namespace  string        `json:"-"`
	Workspace  string        `json:"workspace"`
	Content    string        `json:"content"`
	Section    ThreadSection `json:"section"`
	MemoryType MemoryType    `json:"memoryType,omitempty"`
	Confidence float64       `json:"confidence,omitempty"`
	Tags       []string      `json:"tags,omitempty"`
}

// CloseThreadRequest is the payload for POST /threads/{id}/close.
type CloseThreadRequest struct {
	Distill bool `json:"distill"`
}

// ThreadWithEntries is a thread with all its entries populated.
type ThreadWithEntries struct {
	FeatureThread
	Entries []ThreadEntry `json:"entries"`
}

// CloseThreadResponse is returned from POST /threads/{id}/close.
type CloseThreadResponse struct {
	ThreadID          string   `json:"threadId"`
	Status            string   `json:"status"`
	DistilledMemories []string `json:"distilledMemories,omitempty"`
}

// ThreadContextResponse is returned from GET /threads/{id}/context and
// GET /threads/active/context.
type ThreadContextResponse struct {
	Context string `json:"context"`
}

// ListThreadsRequest holds parsed query params for GET /threads.
type ListThreadsRequest struct {
	Namespace   string       `json:"-"`
	Workspace   string       `json:"workspace"`
	Status      ThreadStatus `json:"status"`
	Name        string       `json:"name"`
}
