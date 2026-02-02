package models

// MemoryType classifies what kind of knowledge a memory represents.
type MemoryType string

const (
	MemoryTypeWorkingSolution MemoryType = "WORKING_SOLUTION"
	MemoryTypeGotcha          MemoryType = "GOTCHA"
	MemoryTypePattern         MemoryType = "PATTERN"
	MemoryTypeDecision        MemoryType = "DECISION"
	MemoryTypeFailure         MemoryType = "FAILURE"
	MemoryTypePreference      MemoryType = "PREFERENCE"
	MemoryTypeContext         MemoryType = "CONTEXT"
	MemoryTypeSkillHint      MemoryType = "SKILL_HINT"
	MemoryTypeSessionSummary MemoryType = "SESSION_SUMMARY"
	MemoryTypeAppKnowledge   MemoryType = "APP_KNOWLEDGE"
)

var ValidMemoryTypes = map[MemoryType]bool{
	MemoryTypeWorkingSolution: true,
	MemoryTypeGotcha:          true,
	MemoryTypePattern:         true,
	MemoryTypeDecision:        true,
	MemoryTypeFailure:         true,
	MemoryTypePreference:      true,
	MemoryTypeContext:         true,
	MemoryTypeSkillHint:      true,
	MemoryTypeSessionSummary: true,
	MemoryTypeAppKnowledge:   true,
}

func (t MemoryType) IsValid() bool {
	return ValidMemoryTypes[t]
}

// InitialStability maps each memory type to its initial stability in days.
// Stability determines how quickly a memory decays without reinforcement
// (Ebbinghaus forgetting curve). Higher = more durable.
var InitialStability = map[MemoryType]float64{
	MemoryTypeGotcha:          5.0,
	MemoryTypeWorkingSolution: 5.0,
	MemoryTypeDecision:        7.0,
	MemoryTypePattern:         10.0,
	MemoryTypePreference:      30.0,
	MemoryTypeContext:         2.0,
	MemoryTypeFailure:         5.0,
	MemoryTypeSkillHint:      30.0,
	MemoryTypeSessionSummary: 3.0,
	MemoryTypeAppKnowledge:   30.0,
}

// Tier represents the storage tier of a memory.
type Tier string

const (
	TierShort Tier = "short"
	TierLong  Tier = "long"
)

func (t Tier) IsValid() bool {
	return t == TierShort || t == TierLong
}

// SearchMode controls how search is performed.
type SearchMode string

const (
	SearchModeHybrid  SearchMode = "hybrid"
	SearchModeVector  SearchMode = "vector"
	SearchModeBM25    SearchMode = "bm25"
)

// StoreRequest is the payload for POST /memories.
type StoreRequest struct {
	Namespace        string           `json:"-"` // Set from X-Clive-Namespace header, not JSON body
	Workspace        string           `json:"workspace"`
	Content          string           `json:"content"`
	MemoryType       MemoryType       `json:"memoryType"`
	Tier             Tier             `json:"tier"`
	Confidence       float64          `json:"confidence"`
	Tags             []string         `json:"tags"`
	Source           string           `json:"source"`
	SessionID        string           `json:"sessionId"`
	Global           bool             `json:"global"`
	RelatedFiles     []string         `json:"relatedFiles,omitempty"`
	EncodingContext  *EncodingContext `json:"encodingContext,omitempty"`
	CompletionStatus *string          `json:"completionStatus,omitempty"`
}

// StoreResponse is returned from POST /memories.
type StoreResponse struct {
	ID                string  `json:"id"`
	Deduplicated      bool    `json:"deduplicated"`
	NearDuplicateID   string  `json:"nearDuplicateId,omitempty"`
	NearDupSimilarity float64 `json:"nearDupSimilarity,omitempty"`
	Skipped           bool    `json:"skipped,omitempty"`
	SkipReason        string  `json:"skipReason,omitempty"`
}

// SearchRequest is the payload for POST /memories/search.
type SearchRequest struct {
	Namespace      string           `json:"-"` // Set from X-Clive-Namespace header, not JSON body
	Workspace      string           `json:"workspace"`
	Query          string           `json:"query"`
	MaxResults     int              `json:"maxResults"`
	MinScore       float64          `json:"minScore"`
	MemoryTypes    []MemoryType     `json:"memoryTypes"`
	Tier           string           `json:"tier"`
	IncludeGlobal  bool             `json:"includeGlobal"`
	SearchMode     SearchMode       `json:"searchMode"`
	SessionContext *EncodingContext `json:"sessionContext,omitempty"`
}

// SearchResult is a single result from a search.
type SearchResult struct {
	ID             string     `json:"id"`
	Content        string     `json:"content"`
	Score          float64    `json:"score"`
	MemoryType     MemoryType `json:"memoryType"`
	Tier           Tier       `json:"tier"`
	Confidence     float64    `json:"confidence"`
	Tags           []string   `json:"tags"`
	Source         string     `json:"source"`
	ImpactScore    float64    `json:"impactScore"`
	CreatedAt      int64      `json:"createdAt"`
	Stability      float64    `json:"stability"`
	LastAccessedAt *int64     `json:"lastAccessedAt,omitempty"`
	Retrievability float64    `json:"retrievability"`
}

// SearchResponse is returned from POST /memories/search.
type SearchResponse struct {
	Results []SearchResult `json:"results"`
	Meta    SearchMeta     `json:"meta"`
}

type SearchMeta struct {
	TotalResults  int `json:"totalResults"`
	VectorResults int `json:"vectorResults"`
	BM25Results   int `json:"bm25Results"`
	SearchTimeMs  int `json:"searchTimeMs"`
}

// BulkStoreRequest is the payload for POST /memories/bulk.
type BulkStoreRequest struct {
	Namespace string         `json:"-"` // Set from X-Clive-Namespace header, not JSON body
	Workspace string         `json:"workspace"`
	Memories  []BulkMemory   `json:"memories"`
	SessionID string         `json:"sessionId"`
}

type BulkMemory struct {
	Content    string     `json:"content"`
	MemoryType MemoryType `json:"memoryType"`
	Confidence float64    `json:"confidence"`
	Tags       []string   `json:"tags"`
	Source       string     `json:"source"`
	Global       bool       `json:"global"`
	RelatedFiles []string   `json:"relatedFiles,omitempty"`
}

// BulkStoreResponse is returned from POST /memories/bulk.
type BulkStoreResponse struct {
	Stored       int `json:"stored"`
	Deduplicated int `json:"deduplicated"`
	Failed       int `json:"failed"`
}

// CompactRequest is the payload for POST /memories/compact.
type CompactRequest struct {
	Namespace string `json:"-"` // Set from X-Clive-Namespace header, not JSON body
	Workspace string `json:"workspace"`
}

// CompactResponse is returned from POST /memories/compact.
type CompactResponse struct {
	Expired       int `json:"expired"`
	Promoted      int `json:"promoted"`
	ForgottenLow  int `json:"forgottenLow,omitempty"`
}

// UpdateRequest is the payload for PATCH /memories/:id.
type UpdateRequest struct {
	Tier             *Tier       `json:"tier,omitempty"`
	Confidence       *float64    `json:"confidence,omitempty"`
	Tags             *[]string   `json:"tags,omitempty"`
	Content          *string     `json:"content,omitempty"`
	MemoryType       *MemoryType `json:"memoryType,omitempty"`
	CompletionStatus *string     `json:"completionStatus,omitempty"`
}

// SupersedeRequest is the payload for POST /memories/{id}/supersede.
type SupersedeRequest struct {
	NewMemoryID string `json:"newMemoryId"`
}

// SupersedeResponse is returned from POST /memories/{id}/supersede.
type SupersedeResponse struct {
	SupersededID string `json:"supersededId"`
	NewMemoryID  string `json:"newMemoryId"`
}

// ListRequest holds parsed query params for GET /memories.
// Sort whitelist: "created_at", "updated_at", "confidence", "access_count", "impact_score"
type ListRequest struct {
	Page        int          `json:"page"`
	Limit       int          `json:"limit"`
	Sort        string       `json:"sort"`
	Order       string       `json:"order"`
	WorkspaceID string       `json:"workspaceId"`
	MemoryTypes []MemoryType `json:"memoryTypes"`
	Tier        string       `json:"tier"`
	Source      string       `json:"source"`
}

// Pagination holds pagination metadata.
type Pagination struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

// ListResponse is returned from GET /memories.
type ListResponse struct {
	Memories   []*Memory  `json:"memories"`
	Pagination Pagination `json:"pagination"`
}

// WorkspaceStats is returned from GET /workspaces/:id/stats.
type WorkspaceStats struct {
	WorkspaceID    string         `json:"workspaceId"`
	WorkspaceName  string         `json:"workspaceName"`
	WorkspacePath  string         `json:"workspacePath"`
	TotalMemories  int            `json:"totalMemories"`
	ShortTermCount int            `json:"shortTermCount"`
	LongTermCount  int            `json:"longTermCount"`
	ByType         map[string]int `json:"byType"`
	LastAccessedAt int64          `json:"lastAccessedAt"`
}

// ImpactSignal represents the type of impact event.
type ImpactSignal string

const (
	SignalHelpful  ImpactSignal = "helpful"
	SignalPromoted ImpactSignal = "promoted"
	SignalCited    ImpactSignal = "cited"
)

// SignalDeltas maps each signal type to its impact score increment.
var SignalDeltas = map[ImpactSignal]float64{
	SignalHelpful:  0.15,
	SignalPromoted: 0.25,
	SignalCited:    0.10,
}

func (s ImpactSignal) IsValid() bool {
	_, ok := SignalDeltas[s]
	return ok
}

// ImpactEvent records a single impact signal on a memory.
type ImpactEvent struct {
	ID        int64        `json:"id"`
	MemoryID  string       `json:"memoryId"`
	Signal    ImpactSignal `json:"signal"`
	Source    string       `json:"source"`
	SessionID string       `json:"sessionId,omitempty"`
	CreatedAt int64        `json:"createdAt"`
}

// RecordImpactRequest is the payload for POST /memories/{id}/impact.
type RecordImpactRequest struct {
	Signal    ImpactSignal `json:"signal"`
	Source    string       `json:"source"`
	SessionID string      `json:"sessionId,omitempty"`
}

// RecordImpactResponse is returned from POST /memories/{id}/impact.
type RecordImpactResponse struct {
	ImpactScore float64 `json:"impactScore"`
	Promoted    bool    `json:"promoted"`
}

// --- Progressive Token Disclosure (3-Layer Search) ---

// SearchIndexResult is a compact search result for Layer 1 (index only).
type SearchIndexResult struct {
	ID             string     `json:"id"`
	Score          float64    `json:"score"`
	MemoryType     MemoryType `json:"memoryType"`
	Tier           Tier       `json:"tier"`
	Confidence     float64    `json:"confidence"`
	Tags           []string   `json:"tags"`
	ImpactScore    float64    `json:"impactScore"`
	ContentPreview string     `json:"contentPreview"`
	CreatedAt      int64      `json:"createdAt"`
}

// SearchIndexResponse is returned from POST /memories/search/index (Layer 1).
type SearchIndexResponse struct {
	Results []SearchIndexResult `json:"results"`
	Meta    SearchMeta          `json:"meta"`
}

// TimelineRequest is the payload for POST /memories/timeline (Layer 2).
type TimelineRequest struct {
	Namespace    string `json:"-"` // Set from X-Clive-Namespace header, not JSON body
	MemoryID     string `json:"memoryId"`
	Workspace    string `json:"workspace"`
	WindowMinutes int   `json:"windowMinutes"`
	MaxResults   int    `json:"maxResults"`
}

// TimelineResponse is returned from POST /memories/timeline (Layer 2).
type TimelineResponse struct {
	Anchor  *Memory   `json:"anchor"`
	Before  []*Memory `json:"before"`
	After   []*Memory `json:"after"`
}

// BatchGetRequest is the payload for POST /memories/batch (Layer 3).
type BatchGetRequest struct {
	IDs []string `json:"ids"`
}

// BatchGetResponse is returned from POST /memories/batch (Layer 3).
type BatchGetResponse struct {
	Memories []*Memory `json:"memories"`
	Missing  []string  `json:"missing,omitempty"`
}

// --- Sessions ---

// Session represents a Claude Code session.
type Session struct {
	ID              string `json:"id"`
	WorkspaceID     string `json:"workspaceId"`
	StartedAt       int64  `json:"startedAt"`
	EndedAt         *int64 `json:"endedAt,omitempty"`
	SummaryMemoryID string `json:"summaryMemoryId,omitempty"`
	PromptCount     int    `json:"promptCount"`
}

// SummarizeRequest is the payload for POST /sessions/summarize.
type SummarizeRequest struct {
	Namespace  string `json:"-"` // Set from X-Clive-Namespace header, not JSON body
	SessionID  string `json:"sessionId"`
	Workspace  string `json:"workspace"`
	Transcript string `json:"transcript"`
}

// SummarizeResponse is returned from POST /sessions/summarize.
type SummarizeResponse struct {
	SessionID       string `json:"sessionId"`
	SummaryMemoryID string `json:"summaryMemoryId"`
	Summary         string `json:"summary"`
}

// --- Observations ---

// Observation records what happened after a tool use.
type Observation struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	ToolName  string `json:"toolName"`
	Input     string `json:"input,omitempty"`
	Output    string `json:"output,omitempty"`
	Success   bool   `json:"success"`
	CreatedAt int64  `json:"createdAt"`
	Sequence  int    `json:"sequence"`
}

// StoreObservationRequest is the payload for POST /sessions/{id}/observations.
type StoreObservationRequest struct {
	ToolName string `json:"toolName"`
	Input    string `json:"input"`
	Output   string `json:"output"`
	Success  bool   `json:"success"`
}

// HealthResponse is returned from GET /health.
type HealthResponse struct {
	Status      string       `json:"status"`
	Ollama      ServiceCheck `json:"ollama"`
	Qdrant      ServiceCheck `json:"qdrant"`
	DB          ServiceCheck `json:"db"`
	MemoryCount int          `json:"memoryCount"`
}

type ServiceCheck struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}
