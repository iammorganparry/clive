package models

// Memory is the core domain entity stored in SQLite.
type Memory struct {
	ID             string     `json:"id"`
	WorkspaceID    string     `json:"workspaceId"`
	Content        string     `json:"content"`
	MemoryType     MemoryType `json:"memoryType"`
	Tier           Tier       `json:"tier"`
	Confidence     float64    `json:"confidence"`
	AccessCount    int        `json:"accessCount"`
	Tags           []string   `json:"tags"`
	Source         string     `json:"source"`
	SessionID      string     `json:"sessionId"`
	ContentHash    string     `json:"contentHash"`
	Embedding      []byte     `json:"-"`
	EmbeddingModel string     `json:"-"`
	CreatedAt      int64      `json:"createdAt"`
	UpdatedAt      int64      `json:"updatedAt"`
	ExpiresAt      *int64     `json:"expiresAt,omitempty"`
	ImpactScore    float64    `json:"impactScore"`
	RelatedFiles   []string   `json:"relatedFiles,omitempty"`

	// Feature 1: Forgetting Curve
	Stability      float64 `json:"stability"`
	LastAccessedAt *int64  `json:"lastAccessedAt,omitempty"`

	// Feature 2: Encoding Specificity
	EncodingContext *EncodingContext `json:"encodingContext,omitempty"`

	// Feature 3: Interference Management
	SupersededBy *string `json:"supersededBy,omitempty"`

	// Feature 5: Zeigarnik Effect
	CompletionStatus *string `json:"completionStatus,omitempty"`

	// Feature Thread association
	ThreadID *string `json:"threadId,omitempty"`
}

// EncodingContext captures the context in which a memory was created,
// enabling better retrieval when similar contexts recur.
type EncodingContext struct {
	FileTypes  []string `json:"fileTypes,omitempty"`
	Frameworks []string `json:"frameworks,omitempty"`
	TaskType   string   `json:"taskType,omitempty"`
}

// Workspace tracks registered project workspaces.
type Workspace struct {
	ID             string `json:"id"`
	Path           string `json:"path"`
	Name           string `json:"name"`
	CreatedAt      int64  `json:"createdAt"`
	LastAccessedAt int64  `json:"lastAccessedAt"`
}

// EmbeddingCacheEntry stores a cached embedding keyed by content hash.
type EmbeddingCacheEntry struct {
	ContentHash string `json:"contentHash"`
	Embedding   []byte `json:"embedding"`
	Dimension   int    `json:"dimension"`
	Model       string `json:"model"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// GlobalWorkspaceID is the sentinel workspace for cross-project knowledge.
const GlobalWorkspaceID = "__global__"
