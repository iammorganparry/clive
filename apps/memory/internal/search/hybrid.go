package search

import (
	"math"
	"sort"
	"time"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
	"github.com/iammorganparry/clive/apps/memory/internal/vectorstore"
)

// HybridSearcher merges results from short-term vector (SQLite), long-term
// vector (Qdrant), and BM25 keyword (FTS5) searches, applying cognitive
// science–driven scoring: forgetting curve, encoding specificity, interference
// management, spreading activation, and Zeigarnik effect.
type HybridSearcher struct {
	memoryStore   *store.MemoryStore
	bm25Store     *store.BM25Store
	linkStore     *store.LinkStore
	qdrantClient  *vectorstore.QdrantClient
	collMgr       *vectorstore.CollectionManager
	vectorWeight  float64
	bm25Weight    float64
	longTermBoost float64
}

func NewHybridSearcher(
	memoryStore *store.MemoryStore,
	bm25Store *store.BM25Store,
	linkStore *store.LinkStore,
	qdrantClient *vectorstore.QdrantClient,
	collMgr *vectorstore.CollectionManager,
	vectorWeight, bm25Weight, longTermBoost float64,
) *HybridSearcher {
	return &HybridSearcher{
		memoryStore:   memoryStore,
		bm25Store:     bm25Store,
		linkStore:     linkStore,
		qdrantClient:  qdrantClient,
		collMgr:       collMgr,
		vectorWeight:  vectorWeight,
		bm25Weight:    bm25Weight,
		longTermBoost: longTermBoost,
	}
}

// SearchParams controls how a search is executed.
type SearchParams struct {
	QueryVector    []float32
	QueryText      string
	WorkspaceIDs   []string
	MaxResults     int
	MinScore       float64
	MemoryTypes    []models.MemoryType
	Tier           string
	SearchMode     models.SearchMode
	SessionContext *models.EncodingContext
}

// Result is a merged, scored search result.
type Result struct {
	Memory         *models.Memory
	VectorScore    float64
	BM25Score      float64
	FinalScore     float64
	Retrievability float64
}

// Retrievability computes the exponential decay of a memory based on elapsed
// time since last access and its stability (Ebbinghaus forgetting curve).
// Returns a value in [0.05, 1.0].
func Retrievability(createdAt int64, lastAccessedAt *int64, stability float64) float64 {
	if stability <= 0 {
		stability = 5.0
	}

	refTime := createdAt
	if lastAccessedAt != nil && *lastAccessedAt > 0 {
		refTime = *lastAccessedAt
	}

	elapsedDays := float64(time.Now().Unix()-refTime) / 86400.0
	if elapsedDays < 0 {
		elapsedDays = 0
	}

	r := math.Exp(-elapsedDays / stability)
	if r < 0.05 {
		return 0.05
	}
	return r
}

// ContextMatchBonus computes an additive bonus [0.0, 0.30] based on overlap
// between the stored encoding context and the current session context
// (Tulving's encoding specificity principle).
func ContextMatchBonus(stored, session *models.EncodingContext) float64 {
	if stored == nil || session == nil {
		return 0.0
	}

	bonus := 0.0

	// File type overlap: up to 0.10
	if len(stored.FileTypes) > 0 && len(session.FileTypes) > 0 {
		overlap := setOverlapRatio(stored.FileTypes, session.FileTypes)
		bonus += overlap * 0.10
	}

	// Framework overlap: up to 0.15
	if len(stored.Frameworks) > 0 && len(session.Frameworks) > 0 {
		overlap := setOverlapRatio(stored.Frameworks, session.Frameworks)
		bonus += overlap * 0.15
	}

	// Task type exact match: 0.05
	if stored.TaskType != "" && session.TaskType != "" && stored.TaskType == session.TaskType {
		bonus += 0.05
	}

	if bonus > 0.30 {
		bonus = 0.30
	}
	return bonus
}

// setOverlapRatio returns |A ∩ B| / |A ∪ B| (Jaccard index).
func setOverlapRatio(a, b []string) float64 {
	setA := make(map[string]bool, len(a))
	for _, v := range a {
		setA[v] = true
	}

	intersection := 0
	union := make(map[string]bool, len(a)+len(b))
	for k := range setA {
		union[k] = true
	}
	for _, v := range b {
		union[v] = true
		if setA[v] {
			intersection++
		}
	}

	if len(union) == 0 {
		return 0.0
	}
	return float64(intersection) / float64(len(union))
}

// Search executes the hybrid search and returns merged results.
func (h *HybridSearcher) Search(params SearchParams) ([]Result, int, int, time.Duration, error) {
	start := time.Now()
	merged := make(map[string]*Result)
	vectorCount := 0
	bm25Count := 0

	mode := params.SearchMode
	if mode == "" {
		mode = models.SearchModeHybrid
	}

	// Vector search (both short-term and long-term)
	if mode == models.SearchModeHybrid || mode == models.SearchModeVector {
		// Short-term: brute-force cosine on SQLite BLOBs
		if params.Tier == "" || params.Tier == string(models.TierShort) {
			shortMems, err := h.memoryStore.GetShortTermWithEmbeddings(params.WorkspaceIDs)
			if err != nil {
				return nil, 0, 0, 0, err
			}
			for _, m := range shortMems {
				if !h.matchesFilters(m, params) {
					continue
				}
				emb := BytesToFloat32(m.Embedding)
				sim := CosineSimilarity(params.QueryVector, emb)
				if sim >= params.MinScore {
					vectorCount++
					h.addOrUpdateCogSci(merged, m, sim, 0, 1.0, params.SessionContext)
				}
			}
		}

		// Long-term: Qdrant ANN search per workspace collection
		if params.Tier == "" || params.Tier == string(models.TierLong) {
			for _, wsID := range params.WorkspaceIDs {
				colName := vectorstore.CollectionName(wsID)
				exists, err := h.qdrantClient.CollectionExists(colName)
				if err != nil || !exists {
					continue
				}
				results, err := h.qdrantClient.Search(colName, params.QueryVector, params.MaxResults*2, params.MinScore)
				if err != nil {
					continue // Non-fatal: skip this collection
				}
				for _, r := range results {
					mem, err := h.memoryStore.GetByID(r.ID)
					if err != nil || mem == nil {
						continue
					}
					if !h.matchesFilters(mem, params) {
						continue
					}
					vectorCount++
					h.addOrUpdateCogSci(merged, mem, r.Score, 0, h.longTermBoost, params.SessionContext)
				}
			}
		}
	}

	// BM25 search
	if mode == models.SearchModeHybrid || mode == models.SearchModeBM25 {
		bm25Results, err := h.bm25Store.Search(params.QueryText, params.WorkspaceIDs, params.MaxResults*3)
		if err == nil {
			// Normalize BM25 scores: scale to [0, 1] range
			maxRank := 0.0
			for _, r := range bm25Results {
				if r.Rank > maxRank {
					maxRank = r.Rank
				}
			}
			for _, r := range bm25Results {
				mem, err := h.memoryStore.GetByID(r.ID)
				if err != nil || mem == nil {
					continue
				}
				if !h.matchesFilters(mem, params) {
					continue
				}
				bm25Count++
				normalizedScore := 0.0
				if maxRank > 0 {
					normalizedScore = r.Rank / maxRank
				}
				boost := 1.0
				if mem.Tier == models.TierLong {
					boost = h.longTermBoost
				}
				h.addOrUpdateCogSci(merged, mem, 0, normalizedScore, boost, params.SessionContext)
			}
		}
	}

	// Sort by final score
	results := make([]Result, 0, len(merged))
	for _, r := range merged {
		if r.FinalScore >= params.MinScore {
			results = append(results, *r)
		}
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].FinalScore > results[j].FinalScore
	})

	// Limit
	if len(results) > params.MaxResults {
		results = results[:params.MaxResults]
	}

	// Feature 4: Spreading Activation — one-hop boost from linked memories
	if h.linkStore != nil && len(results) > 0 {
		results = h.applySpreadingActivation(results, merged, params)
	}

	// Re-sort after spreading activation
	sort.Slice(results, func(i, j int) bool {
		return results[i].FinalScore > results[j].FinalScore
	})

	// Final limit
	if len(results) > params.MaxResults {
		results = results[:params.MaxResults]
	}

	// Post-search: increment access counts and update stability for returned results.
	// Also build co_accessed links between returned memories.
	resultIDs := make([]string, len(results))
	for i, r := range results {
		resultIDs[i] = r.Memory.ID
		_ = h.memoryStore.IncrementAccessCount(r.Memory.ID)
		_ = h.memoryStore.UpdateStabilityOnAccess(r.Memory.ID, r.Memory.ImpactScore)
	}

	// Feature 4: Build co_accessed links between co-retrieved memories
	if h.linkStore != nil && len(resultIDs) > 1 {
		for i := 0; i < len(resultIDs); i++ {
			for j := i + 1; j < len(resultIDs); j++ {
				_ = h.linkStore.CreateOrStrengthen(resultIDs[i], resultIDs[j], "co_accessed", 0.1)
			}
		}
	}

	return results, vectorCount, bm25Count, time.Since(start), nil
}

// addOrUpdateCogSci computes the cognitive science–enhanced score:
//
//	final = (vector × 0.7 + bm25 × 0.3) × long_term_boost × retrievability × zeigarnik_boost
//	        + context_match_bonus
func (h *HybridSearcher) addOrUpdateCogSci(
	merged map[string]*Result,
	mem *models.Memory,
	vectorScore, bm25Score float64,
	boost float64,
	sessionCtx *models.EncodingContext,
) {
	// Feature 3: Filter out superseded memories
	if mem.SupersededBy != nil && *mem.SupersededBy != "" {
		return
	}

	// Feature 1: Retrievability
	retr := Retrievability(mem.CreatedAt, mem.LastAccessedAt, mem.Stability)

	// Feature 5: Zeigarnik boost
	zeigarnikBoost := 1.0
	if mem.CompletionStatus != nil && *mem.CompletionStatus == "incomplete" {
		zeigarnikBoost = 1.5
	}

	// Feature 2: Context match bonus
	ctxBonus := ContextMatchBonus(mem.EncodingContext, sessionCtx)

	existing, ok := merged[mem.ID]
	if ok {
		// Update with the better scores
		if vectorScore > existing.VectorScore {
			existing.VectorScore = vectorScore
		}
		if bm25Score > existing.BM25Score {
			existing.BM25Score = bm25Score
		}
		existing.Retrievability = retr
		existing.FinalScore = (existing.VectorScore*h.vectorWeight+existing.BM25Score*h.bm25Weight)*boost*retr*zeigarnikBoost + ctxBonus
	} else {
		finalScore := (vectorScore*h.vectorWeight+bm25Score*h.bm25Weight)*boost*retr*zeigarnikBoost + ctxBonus
		merged[mem.ID] = &Result{
			Memory:         mem,
			VectorScore:    vectorScore,
			BM25Score:      bm25Score,
			FinalScore:     finalScore,
			Retrievability: retr,
		}
	}
}

// applySpreadingActivation does a one-hop activation boost for the top-3 results.
// Linked memories that aren't already in results get an additive boost of
// link.Strength × 0.1, capped at 0.2 total.
func (h *HybridSearcher) applySpreadingActivation(results []Result, merged map[string]*Result, params SearchParams) []Result {
	topN := 3
	if len(results) < topN {
		topN = len(results)
	}

	for i := 0; i < topN; i++ {
		links, err := h.linkStore.GetLinked(results[i].Memory.ID, 5)
		if err != nil {
			continue
		}
		for _, link := range links {
			// Determine which end is the linked memory
			linkedID := link.TargetID
			if linkedID == results[i].Memory.ID {
				linkedID = link.SourceID
			}

			activationBoost := link.Strength * 0.1
			if activationBoost > 0.2 {
				activationBoost = 0.2
			}

			if existing, ok := merged[linkedID]; ok {
				// Already in results — boost it
				existing.FinalScore += activationBoost
			} else {
				// Not in results — fetch and add with spreading activation bonus
				mem, err := h.memoryStore.GetByID(linkedID)
				if err != nil || mem == nil {
					continue
				}
				// Skip superseded
				if mem.SupersededBy != nil && *mem.SupersededBy != "" {
					continue
				}
				if !h.matchesFilters(mem, params) {
					continue
				}
				retr := Retrievability(mem.CreatedAt, mem.LastAccessedAt, mem.Stability)
				r := &Result{
					Memory:         mem,
					FinalScore:     activationBoost,
					Retrievability: retr,
				}
				merged[linkedID] = r
				results = append(results, *r)
			}
		}
	}

	return results
}

func (h *HybridSearcher) matchesFilters(m *models.Memory, p SearchParams) bool {
	if len(p.MemoryTypes) > 0 {
		found := false
		for _, t := range p.MemoryTypes {
			if m.MemoryType == t {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if p.Tier != "" && string(m.Tier) != p.Tier {
		return false
	}
	return true
}
