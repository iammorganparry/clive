package memory

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/anthropics/clive/apps/memory/internal/embedding"
	"github.com/anthropics/clive/apps/memory/internal/models"
	"github.com/anthropics/clive/apps/memory/internal/privacy"
	"github.com/anthropics/clive/apps/memory/internal/search"
	"github.com/anthropics/clive/apps/memory/internal/store"
	"github.com/anthropics/clive/apps/memory/internal/vectorstore"
)

// Service is the main facade for all memory operations.
type Service struct {
	memoryStore    *store.MemoryStore
	workspaceStore *store.WorkspaceStore
	bm25Store      *store.BM25Store
	embedder       *embedding.CachedEmbedder
	qdrantClient   *vectorstore.QdrantClient
	collMgr        *vectorstore.CollectionManager
	searcher       *search.HybridSearcher
	dedup          *Deduplicator
	lifecycle      *LifecycleManager
	shortTermTTL   time.Duration
	logger         *slog.Logger
}

// NewService creates a new memory service with all dependencies.
func NewService(
	memoryStore *store.MemoryStore,
	workspaceStore *store.WorkspaceStore,
	bm25Store *store.BM25Store,
	embedder *embedding.CachedEmbedder,
	qdrantClient *vectorstore.QdrantClient,
	collMgr *vectorstore.CollectionManager,
	searcher *search.HybridSearcher,
	dedup *Deduplicator,
	lifecycle *LifecycleManager,
	shortTermTTLHours int,
	logger *slog.Logger,
) *Service {
	return &Service{
		memoryStore:    memoryStore,
		workspaceStore: workspaceStore,
		bm25Store:      bm25Store,
		embedder:       embedder,
		qdrantClient:   qdrantClient,
		collMgr:        collMgr,
		searcher:       searcher,
		dedup:          dedup,
		lifecycle:      lifecycle,
		shortTermTTL:   time.Duration(shortTermTTLHours) * time.Hour,
		logger:         logger,
	}
}

// Store creates a new memory with dedup, embedding, and cognitive science fields.
func (s *Service) Store(req *models.StoreRequest) (*models.StoreResponse, error) {
	// Privacy filter: strip <private>...</private> blocks before processing
	if privacy.HasOnlyPrivateContent(req.Content) {
		return &models.StoreResponse{Skipped: true, SkipReason: "content_private"}, nil
	}
	req.Content = privacy.StripPrivateTags(req.Content)

	// Determine workspace
	workspaceID := models.GlobalWorkspaceID
	if !req.Global && req.Workspace != "" {
		id, err := s.workspaceStore.EnsureWorkspace(req.Workspace)
		if err != nil {
			return nil, fmt.Errorf("ensure workspace: %w", err)
		}
		workspaceID = id
	}

	// Generate embedding
	vec, err := s.embedder.Embed(req.Content)
	if err != nil {
		return nil, fmt.Errorf("embed content: %w", err)
	}

	// Dedup check (Feature 3: enhanced with near-duplicate detection)
	dedupResult, err := s.dedup.CheckDuplicate(workspaceID, req.Content, vec)
	if err != nil {
		s.logger.Warn("dedup check failed", "error", err)
		dedupResult = &DedupResult{} // continue with empty result
	}
	if dedupResult.ExactDuplicateID != "" {
		return &models.StoreResponse{ID: dedupResult.ExactDuplicateID, Deduplicated: true}, nil
	}

	// Set defaults
	tier := req.Tier
	if tier == "" {
		tier = models.TierShort
	}
	confidence := req.Confidence
	if confidence == 0 {
		confidence = 0.8
	}

	now := time.Now().Unix()
	id := uuid.New().String()
	contentHash := embedding.ContentHash(req.Content)

	// Feature 1: Set initial stability from memory type
	stability := 5.0
	if s, ok := models.InitialStability[req.MemoryType]; ok {
		stability = s
	}

	mem := &models.Memory{
		ID:              id,
		WorkspaceID:     workspaceID,
		Content:         req.Content,
		MemoryType:      req.MemoryType,
		Tier:            tier,
		Confidence:      confidence,
		AccessCount:     0,
		Tags:            req.Tags,
		Source:          req.Source,
		SessionID:       req.SessionID,
		ContentHash:     contentHash,
		RelatedFiles:    req.RelatedFiles,
		EmbeddingModel:  "nomic-embed-text",
		CreatedAt:       now,
		UpdatedAt:       now,
		Stability:       stability,
		LastAccessedAt:  &now,
		EncodingContext: req.EncodingContext,
		CompletionStatus: req.CompletionStatus,
	}

	if tier == models.TierShort {
		// Short-term: store embedding in SQLite, set TTL
		mem.Embedding = search.Float32ToBytes(vec)
		expiresAt := now + int64(s.shortTermTTL.Seconds())
		mem.ExpiresAt = &expiresAt
	} else {
		// Long-term: store embedding in Qdrant
		colName, err := s.collMgr.EnsureForWorkspace(workspaceID)
		if err != nil {
			return nil, fmt.Errorf("ensure qdrant collection: %w", err)
		}

		point := vectorstore.Point{
			ID:     id,
			Vector: vec,
			Payload: map[string]any{
				"memory_type":     string(req.MemoryType),
				"confidence":      confidence,
				"tags":            req.Tags,
				"content_preview": truncate(req.Content, 200),
				"created_at":      now,
			},
		}
		if err := s.qdrantClient.Upsert(colName, []vectorstore.Point{point}); err != nil {
			return nil, fmt.Errorf("upsert to qdrant: %w", err)
		}
		// No embedding or expiry in SQLite for long-term
	}

	if err := s.memoryStore.Insert(mem); err != nil {
		return nil, fmt.Errorf("insert memory: %w", err)
	}

	resp := &models.StoreResponse{ID: id, Deduplicated: false}

	// Feature 3: Include near-duplicate info in response
	if dedupResult.NearDuplicateID != "" {
		resp.NearDuplicateID = dedupResult.NearDuplicateID
		resp.NearDupSimilarity = dedupResult.NearDupSimilarity
	}

	return resp, nil
}

// Supersede marks an old memory as superseded by a new one (Feature 3).
func (s *Service) Supersede(oldID, newID string) (*models.SupersedeResponse, error) {
	// Verify both memories exist
	oldMem, err := s.memoryStore.GetByID(oldID)
	if err != nil {
		return nil, err
	}
	if oldMem == nil {
		return nil, fmt.Errorf("old memory not found: %s", oldID)
	}
	newMem, err := s.memoryStore.GetByID(newID)
	if err != nil {
		return nil, err
	}
	if newMem == nil {
		return nil, fmt.Errorf("new memory not found: %s", newID)
	}

	if err := s.memoryStore.Supersede(oldID, newID); err != nil {
		return nil, fmt.Errorf("supersede: %w", err)
	}

	return &models.SupersedeResponse{
		SupersededID: oldID,
		NewMemoryID:  newID,
	}, nil
}

// Search performs hybrid search.
func (s *Service) Search(req *models.SearchRequest) (*models.SearchResponse, error) {
	workspaceIDs := []string{}
	if req.Workspace != "" {
		id, err := s.workspaceStore.EnsureWorkspace(req.Workspace)
		if err != nil {
			return nil, fmt.Errorf("ensure workspace: %w", err)
		}
		workspaceIDs = append(workspaceIDs, id)
	}
	if req.IncludeGlobal {
		workspaceIDs = append(workspaceIDs, models.GlobalWorkspaceID)
	}
	if len(workspaceIDs) == 0 {
		return &models.SearchResponse{Results: []models.SearchResult{}}, nil
	}

	// Embed query
	vec, err := s.embedder.Embed(req.Query)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}

	maxResults := req.MaxResults
	if maxResults == 0 {
		maxResults = 10
	}
	minScore := req.MinScore

	params := search.SearchParams{
		QueryVector:    vec,
		QueryText:      req.Query,
		WorkspaceIDs:   workspaceIDs,
		MaxResults:     maxResults,
		MinScore:       minScore,
		MemoryTypes:    req.MemoryTypes,
		Tier:           req.Tier,
		SearchMode:     req.SearchMode,
		SessionContext: req.SessionContext,
	}

	results, vectorCount, bm25Count, dur, err := s.searcher.Search(params)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}

	searchResults := make([]models.SearchResult, len(results))
	for i, r := range results {
		searchResults[i] = models.SearchResult{
			ID:             r.Memory.ID,
			Content:        r.Memory.Content,
			Score:          r.FinalScore,
			MemoryType:     r.Memory.MemoryType,
			Tier:           r.Memory.Tier,
			Confidence:     r.Memory.Confidence,
			Tags:           r.Memory.Tags,
			Source:         r.Memory.Source,
			ImpactScore:    r.Memory.ImpactScore,
			CreatedAt:      r.Memory.CreatedAt,
			Stability:      r.Memory.Stability,
			LastAccessedAt: r.Memory.LastAccessedAt,
			Retrievability: r.Retrievability,
		}
	}

	return &models.SearchResponse{
		Results: searchResults,
		Meta: models.SearchMeta{
			TotalResults:  len(searchResults),
			VectorResults: vectorCount,
			BM25Results:   bm25Count,
			SearchTimeMs:  int(dur.Milliseconds()),
		},
	}, nil
}

// SearchIndex performs a search and returns compact index results (Layer 1 of progressive disclosure).
func (s *Service) SearchIndex(req *models.SearchRequest) (*models.SearchIndexResponse, error) {
	fullResp, err := s.Search(req)
	if err != nil {
		return nil, err
	}

	indexResults := make([]models.SearchIndexResult, len(fullResp.Results))
	for i, r := range fullResp.Results {
		indexResults[i] = models.SearchIndexResult{
			ID:             r.ID,
			Score:          r.Score,
			MemoryType:     r.MemoryType,
			Tier:           r.Tier,
			Confidence:     r.Confidence,
			Tags:           r.Tags,
			ImpactScore:    r.ImpactScore,
			ContentPreview: truncate(r.Content, 80),
			CreatedAt:      r.CreatedAt,
		}
	}

	return &models.SearchIndexResponse{
		Results: indexResults,
		Meta:    fullResp.Meta,
	}, nil
}

// Timeline returns chronological context around a memory (Layer 2 of progressive disclosure).
func (s *Service) Timeline(req *models.TimelineRequest) (*models.TimelineResponse, error) {
	anchor, err := s.memoryStore.GetByID(req.MemoryID)
	if err != nil {
		return nil, fmt.Errorf("get anchor: %w", err)
	}
	if anchor == nil {
		return nil, fmt.Errorf("memory not found: %s", req.MemoryID)
	}

	windowMinutes := req.WindowMinutes
	if windowMinutes <= 0 {
		windowMinutes = 30
	}
	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = 5
	}

	before, after, err := s.memoryStore.GetTimelineAround(req.MemoryID, windowMinutes, maxResults)
	if err != nil {
		return nil, fmt.Errorf("get timeline: %w", err)
	}

	return &models.TimelineResponse{
		Anchor: anchor,
		Before: before,
		After:  after,
	}, nil
}

// BatchGet retrieves full content for specific memory IDs (Layer 3 of progressive disclosure).
func (s *Service) BatchGet(req *models.BatchGetRequest) (*models.BatchGetResponse, error) {
	if len(req.IDs) == 0 {
		return &models.BatchGetResponse{Memories: []*models.Memory{}}, nil
	}

	memories, err := s.memoryStore.GetByIDs(req.IDs)
	if err != nil {
		return nil, fmt.Errorf("batch get: %w", err)
	}

	// Build set of found IDs to determine missing
	found := make(map[string]bool, len(memories))
	for _, m := range memories {
		found[m.ID] = true
	}
	var missing []string
	for _, id := range req.IDs {
		if !found[id] {
			missing = append(missing, id)
		}
	}

	return &models.BatchGetResponse{
		Memories: memories,
		Missing:  missing,
	}, nil
}

// BulkStore stores multiple memories in a batch.
func (s *Service) BulkStore(req *models.BulkStoreRequest) (*models.BulkStoreResponse, error) {
	resp := &models.BulkStoreResponse{}

	for _, bm := range req.Memories {
		storeReq := &models.StoreRequest{
			Workspace:  req.Workspace,
			Content:    bm.Content,
			MemoryType: bm.MemoryType,
			Tier:       models.TierShort,
			Confidence: bm.Confidence,
			Tags:       bm.Tags,
			Source:     bm.Source,
			SessionID:  req.SessionID,
			Global:     bm.Global,
		}

		result, err := s.Store(storeReq)
		if err != nil {
			s.logger.Error("bulk store item failed", "error", err)
			resp.Failed++
			continue
		}
		if result.Deduplicated {
			resp.Deduplicated++
		} else {
			resp.Stored++
		}
	}

	return resp, nil
}

// Compact runs lifecycle management.
func (s *Service) Compact() (*models.CompactResponse, error) {
	expired, promoted, forgottenLow, err := s.lifecycle.Compact()
	if err != nil {
		return nil, err
	}
	return &models.CompactResponse{
		Expired:      expired,
		Promoted:     promoted,
		ForgottenLow: forgottenLow,
	}, nil
}

// GetByID retrieves a memory by ID.
func (s *Service) GetByID(id string) (*models.Memory, error) {
	return s.memoryStore.GetByID(id)
}

// Update applies partial updates to a memory.
func (s *Service) Update(id string, req *models.UpdateRequest) (*models.Memory, error) {
	// If promoting to long-term, use lifecycle manager
	if req.Tier != nil && *req.Tier == models.TierLong {
		existing, err := s.memoryStore.GetByID(id)
		if err != nil {
			return nil, err
		}
		if existing != nil && existing.Tier == models.TierShort {
			if err := s.lifecycle.PromoteByID(id); err != nil {
				return nil, fmt.Errorf("promote: %w", err)
			}
		}
	}
	return s.memoryStore.Update(id, req)
}

// Delete removes a memory and its Qdrant vector if applicable.
func (s *Service) Delete(id string) error {
	mem, err := s.memoryStore.GetByID(id)
	if err != nil {
		return err
	}
	if mem == nil {
		return fmt.Errorf("memory not found: %s", id)
	}

	// Remove from Qdrant if long-term
	if mem.Tier == models.TierLong {
		colName := vectorstore.CollectionName(mem.WorkspaceID)
		_ = s.qdrantClient.DeletePoints(colName, []string{id})
	}

	return s.memoryStore.Delete(id)
}

// GetWorkspaceStats returns statistics for a workspace.
func (s *Service) GetWorkspaceStats(workspaceID string) (*models.WorkspaceStats, error) {
	ws, err := s.workspaceStore.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	if ws == nil {
		return nil, fmt.Errorf("workspace not found: %s", workspaceID)
	}

	total, shortTerm, longTerm, byType, err := s.memoryStore.CountByWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	return &models.WorkspaceStats{
		WorkspaceID:    ws.ID,
		WorkspaceName:  ws.Name,
		WorkspacePath:  ws.Path,
		TotalMemories:  total,
		ShortTermCount: shortTerm,
		LongTermCount:  longTerm,
		ByType:         byType,
		LastAccessedAt: ws.LastAccessedAt,
	}, nil
}

// List returns a paginated list of memories with filtering and sorting.
func (s *Service) List(req *models.ListRequest) (*models.ListResponse, error) {
	memories, total, err := s.memoryStore.List(req)
	if err != nil {
		return nil, fmt.Errorf("list memories: %w", err)
	}

	limit := req.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	totalPages := total / limit
	if total%limit != 0 {
		totalPages++
	}

	page := req.Page
	if page < 1 {
		page = 1
	}

	return &models.ListResponse{
		Memories: memories,
		Pagination: models.Pagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages,
		},
	}, nil
}

// ListWorkspaces returns all registered workspaces.
func (s *Service) ListWorkspaces() ([]models.Workspace, error) {
	return s.workspaceStore.ListWorkspaces()
}

// RecordImpact records an impact signal on a memory and optionally auto-promotes.
func (s *Service) RecordImpact(id string, req *models.RecordImpactRequest) (*models.RecordImpactResponse, error) {
	mem, err := s.memoryStore.GetByID(id)
	if err != nil {
		return nil, err
	}
	if mem == nil {
		return nil, fmt.Errorf("memory not found: %s", id)
	}

	score, err := s.memoryStore.RecordImpact(id, req.Signal, req.Source, req.SessionID)
	if err != nil {
		return nil, fmt.Errorf("record impact: %w", err)
	}

	resp := &models.RecordImpactResponse{
		ImpactScore: score,
	}

	// Auto-promote if signal is "promoted" and memory is short-term
	if req.Signal == models.SignalPromoted && mem.Tier == models.TierShort {
		if err := s.lifecycle.PromoteByID(id); err != nil {
			s.logger.Error("auto-promote failed", "id", id, "error", err)
		} else {
			resp.Promoted = true
		}
	}

	return resp, nil
}

// GetImpactEvents returns the impact audit trail for a memory.
func (s *Service) GetImpactEvents(id string) ([]models.ImpactEvent, error) {
	return s.memoryStore.GetImpactEvents(id)
}

// GetImpactLeaders returns the top memories by impact score.
func (s *Service) GetImpactLeaders(workspaceID string, limit int) ([]*models.Memory, error) {
	return s.memoryStore.GetImpactLeaders(workspaceID, limit)
}
