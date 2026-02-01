package memory

import (
	"github.com/anthropics/clive/apps/memory/internal/embedding"
	"github.com/anthropics/clive/apps/memory/internal/search"
	"github.com/anthropics/clive/apps/memory/internal/store"
)

// DedupResult captures the outcome of a duplicate check.
type DedupResult struct {
	// ExactDuplicateID is set when an exact content hash match is found
	// or when cosine similarity is ≥ threshold (0.92).
	ExactDuplicateID string
	// NearDuplicateID is set when cosine similarity is in [0.85, threshold).
	// Does NOT block storage — signals a similar memory exists.
	NearDuplicateID string
	// NearDupSimilarity is the cosine similarity of the near-duplicate.
	NearDupSimilarity float64
}

// Deduplicator checks if a memory is a near-duplicate of existing memories.
type Deduplicator struct {
	memoryStore  *store.MemoryStore
	threshold    float64 // exact dup threshold (≥ this => block)
	nearDupLower float64 // near-dup lower bound
}

func NewDeduplicator(memoryStore *store.MemoryStore, threshold float64) *Deduplicator {
	return &Deduplicator{
		memoryStore:  memoryStore,
		threshold:    threshold, // e.g., 0.92
		nearDupLower: 0.85,     // near-dup band: [0.85, threshold)
	}
}

// CheckDuplicate checks for exact hash match, exact vector duplicate, or near-duplicate.
// - ExactDuplicateID: blocks storage (content is identical or cosine ≥ threshold)
// - NearDuplicateID: does NOT block storage but signals a similar memory exists
func (d *Deduplicator) CheckDuplicate(workspaceID, content string, vec []float32) (*DedupResult, error) {
	result := &DedupResult{}
	hash := embedding.ContentHash(content)

	// Exact hash match
	existing, err := d.memoryStore.FindByContentHash(workspaceID, hash)
	if err != nil {
		return nil, err
	}
	if len(existing) > 0 {
		result.ExactDuplicateID = existing[0].ID
		return result, nil
	}

	// Vector similarity check against short-term memories in same workspace
	shortTermMems, err := d.memoryStore.GetShortTermWithEmbeddings([]string{workspaceID})
	if err != nil {
		return nil, err
	}

	bestSim := 0.0
	bestID := ""
	for _, m := range shortTermMems {
		emb := search.BytesToFloat32(m.Embedding)
		if len(emb) == 0 {
			continue
		}
		sim := search.CosineSimilarity(vec, emb)
		if sim > bestSim {
			bestSim = sim
			bestID = m.ID
		}
	}

	if bestSim >= d.threshold {
		// Exact duplicate (cosine ≥ 0.92)
		result.ExactDuplicateID = bestID
	} else if bestSim >= d.nearDupLower {
		// Near duplicate (cosine in [0.85, 0.92)) — flag but don't block
		result.NearDuplicateID = bestID
		result.NearDupSimilarity = bestSim
	}

	return result, nil
}

// IsDuplicate is the legacy API — returns the duplicate ID or empty string.
// Maintained for backward compatibility.
func (d *Deduplicator) IsDuplicate(workspaceID, content string, vec []float32) (string, error) {
	result, err := d.CheckDuplicate(workspaceID, content, vec)
	if err != nil {
		return "", err
	}
	return result.ExactDuplicateID, nil
}
