package memory

import (
	"fmt"
	"log/slog"

	"github.com/anthropics/clive/apps/memory/internal/models"
	"github.com/anthropics/clive/apps/memory/internal/search"
	"github.com/anthropics/clive/apps/memory/internal/store"
	"github.com/anthropics/clive/apps/memory/internal/vectorstore"
)

// LifecycleManager handles TTL expiry, short->long promotion, and compaction.
type LifecycleManager struct {
	memoryStore     *store.MemoryStore
	qdrantClient    *vectorstore.QdrantClient
	collMgr         *vectorstore.CollectionManager
	minAccess       int
	minConfidence   float64
	logger          *slog.Logger
}

func NewLifecycleManager(
	memoryStore *store.MemoryStore,
	qdrantClient *vectorstore.QdrantClient,
	collMgr *vectorstore.CollectionManager,
	minAccess int,
	minConfidence float64,
	logger *slog.Logger,
) *LifecycleManager {
	return &LifecycleManager{
		memoryStore:   memoryStore,
		qdrantClient:  qdrantClient,
		collMgr:       collMgr,
		minAccess:     minAccess,
		minConfidence: minConfidence,
		logger:        logger,
	}
}

// Compact runs TTL expiry, retrievability-based cleanup, and promotion.
// Returns counts of expired, promoted, and forgotten-low-retrievability memories.
func (l *LifecycleManager) Compact() (expired int, promoted int, forgottenLow int, err error) {
	// 1. Expire old short-term memories (existing TTL-based expiry)
	n, err := l.memoryStore.DeleteExpired()
	if err != nil {
		return 0, 0, 0, fmt.Errorf("expire memories: %w", err)
	}
	expired = int(n)
	if expired > 0 {
		l.logger.Info("expired memories", "count", expired)
	}

	// 2. Feature 1: Retrievability-based cleanup for short-term memories.
	// Delete memories whose retrievability has dropped below 0.05 (effectively forgotten).
	// This supplements TTL expiry — a memory may not have expired by TTL but is
	// effectively forgotten if never accessed and stability is low.
	shortTermMems, err := l.memoryStore.GetAllShortTerm()
	if err != nil {
		l.logger.Warn("failed to get short-term memories for retrievability cleanup", "error", err)
	} else {
		for _, m := range shortTermMems {
			retr := search.Retrievability(m.CreatedAt, m.LastAccessedAt, m.Stability)
			if retr < 0.05 {
				if err := l.memoryStore.Delete(m.ID); err != nil {
					l.logger.Error("failed to delete forgotten memory", "id", m.ID, "error", err)
					continue
				}
				forgottenLow++
			}
		}
		if forgottenLow > 0 {
			l.logger.Info("forgotten low-retrievability memories", "count", forgottenLow)
		}
	}

	// 3. Promote eligible short-term memories to long-term
	// Candidates from access count + confidence threshold
	accessCandidates, err := l.memoryStore.GetPromotionCandidates(l.minAccess, l.minConfidence)
	if err != nil {
		return expired, 0, forgottenLow, fmt.Errorf("get promotion candidates: %w", err)
	}

	// Candidates from high impact score
	impactCandidates, err := l.memoryStore.GetImpactPromotionCandidates(0.5)
	if err != nil {
		return expired, 0, forgottenLow, fmt.Errorf("get impact promotion candidates: %w", err)
	}

	// Deduplicate candidates
	seen := make(map[string]bool)
	var allCandidates []*models.Memory
	for _, m := range accessCandidates {
		if !seen[m.ID] {
			seen[m.ID] = true
			allCandidates = append(allCandidates, m)
		}
	}
	for _, m := range impactCandidates {
		if !seen[m.ID] {
			seen[m.ID] = true
			allCandidates = append(allCandidates, m)
		}
	}

	for _, m := range allCandidates {
		if err := l.promote(m); err != nil {
			l.logger.Error("failed to promote memory", "id", m.ID, "error", err)
			continue
		}
		promoted++
	}

	if promoted > 0 {
		l.logger.Info("promoted memories", "count", promoted)
	}

	return expired, promoted, forgottenLow, nil
}

func (l *LifecycleManager) promote(m *models.Memory) error {
	// Move embedding from SQLite to Qdrant
	if len(m.Embedding) == 0 {
		return fmt.Errorf("memory %s has no embedding to promote", m.ID)
	}

	colName, err := l.collMgr.EnsureForWorkspace(m.WorkspaceID)
	if err != nil {
		return fmt.Errorf("ensure collection: %w", err)
	}

	vec := search.BytesToFloat32(m.Embedding)
	point := vectorstore.Point{
		ID:     m.ID,
		Vector: vec,
		Payload: map[string]any{
			"memory_type":     string(m.MemoryType),
			"confidence":      m.Confidence,
			"tags":            m.Tags,
			"content_preview": truncate(m.Content, 200),
			"created_at":      m.CreatedAt,
		},
	}

	if err := l.qdrantClient.Upsert(colName, []vectorstore.Point{point}); err != nil {
		return fmt.Errorf("upsert to qdrant: %w", err)
	}

	// Update SQLite: clear embedding, set tier to long, remove expiry
	if err := l.memoryStore.ClearEmbedding(m.ID); err != nil {
		return fmt.Errorf("clear embedding: %w", err)
	}
	if err := l.memoryStore.SetTier(m.ID, models.TierLong, nil); err != nil {
		return fmt.Errorf("set tier: %w", err)
	}

	return nil
}

// PromoteByID explicitly promotes a specific memory from short to long term.
func (l *LifecycleManager) PromoteByID(id string) error {
	m, err := l.memoryStore.GetByID(id)
	if err != nil {
		return fmt.Errorf("get memory: %w", err)
	}
	if m == nil {
		return fmt.Errorf("memory not found: %s", id)
	}
	if m.Tier == models.TierLong {
		return nil // Already long-term
	}
	return l.promote(m)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
