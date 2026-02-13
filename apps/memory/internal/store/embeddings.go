package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
)

// EmbeddingCacheStore handles embedding cache operations in SQLite.
type EmbeddingCacheStore struct {
	db *DB
}

func NewEmbeddingCacheStore(db *DB) *EmbeddingCacheStore {
	return &EmbeddingCacheStore{db: db}
}

// Get returns a cached embedding by content hash, or nil if not found.
func (s *EmbeddingCacheStore) Get(contentHash string) (*models.EmbeddingCacheEntry, error) {
	var e models.EmbeddingCacheEntry
	err := s.db.QueryRow(`
		SELECT content_hash, embedding, dimension, model, updated_at
		FROM embedding_cache WHERE content_hash = ?
	`, contentHash).Scan(&e.ContentHash, &e.Embedding, &e.Dimension, &e.Model, &e.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get embedding cache: %w", err)
	}
	return &e, nil
}

// Put upserts an embedding cache entry.
func (s *EmbeddingCacheStore) Put(entry *models.EmbeddingCacheEntry) error {
	entry.UpdatedAt = time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO embedding_cache (content_hash, embedding, dimension, model, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(content_hash) DO UPDATE SET
			embedding = excluded.embedding,
			dimension = excluded.dimension,
			model = excluded.model,
			updated_at = excluded.updated_at
	`, entry.ContentHash, entry.Embedding, entry.Dimension, entry.Model, entry.UpdatedAt)
	if err != nil {
		return fmt.Errorf("put embedding cache: %w", err)
	}
	return nil
}
