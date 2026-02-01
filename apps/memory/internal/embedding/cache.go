package embedding

import (
	"crypto/sha256"
	"fmt"

	"github.com/anthropics/clive/apps/memory/internal/models"
	"github.com/anthropics/clive/apps/memory/internal/search"
	"github.com/anthropics/clive/apps/memory/internal/store"
)

// CachedEmbedder wraps an OllamaClient with content-hash caching via SQLite.
type CachedEmbedder struct {
	client *OllamaClient
	cache  *store.EmbeddingCacheStore
	model  string
	dim    int
}

func NewCachedEmbedder(client *OllamaClient, cache *store.EmbeddingCacheStore, model string, dim int) *CachedEmbedder {
	return &CachedEmbedder{
		client: client,
		cache:  cache,
		model:  model,
		dim:    dim,
	}
}

// Embed returns the embedding for text, using cache when available.
func (e *CachedEmbedder) Embed(text string) ([]float32, error) {
	hash := ContentHash(text)

	// Check cache
	entry, err := e.cache.Get(hash)
	if err != nil {
		return nil, fmt.Errorf("cache lookup: %w", err)
	}
	if entry != nil {
		return search.BytesToFloat32(entry.Embedding), nil
	}

	// Generate embedding
	vec, err := e.client.Embed(text)
	if err != nil {
		return nil, err
	}

	// Store in cache
	cacheEntry := &models.EmbeddingCacheEntry{
		ContentHash: hash,
		Embedding:   search.Float32ToBytes(vec),
		Dimension:   e.dim,
		Model:       e.model,
	}
	if err := e.cache.Put(cacheEntry); err != nil {
		// Non-fatal: log but continue
		_ = err
	}

	return vec, nil
}

// ContentHash computes a SHA-256 hash of text content.
func ContentHash(text string) string {
	h := sha256.Sum256([]byte(text))
	return fmt.Sprintf("%x", h)
}
