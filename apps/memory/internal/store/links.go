package store

import (
	"fmt"
	"time"
)

// MemoryLink represents a directional link between two memories.
type MemoryLink struct {
	ID        int64   `json:"id"`
	SourceID  string  `json:"sourceId"`
	TargetID  string  `json:"targetId"`
	LinkType  string  `json:"linkType"`
	Strength  float64 `json:"strength"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt int64   `json:"updatedAt"`
}

// LinkStore handles memory_links CRUD operations on SQLite.
type LinkStore struct {
	db *DB
}

func NewLinkStore(db *DB) *LinkStore {
	return &LinkStore{db: db}
}

// CreateOrStrengthen creates a link or strengthens an existing one.
// Uses ON CONFLICT to upsert, capping strength at 5.0.
func (s *LinkStore) CreateOrStrengthen(sourceID, targetID, linkType string, delta float64) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO memory_links (source_id, target_id, link_type, strength, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(source_id, target_id, link_type) DO UPDATE SET
			strength = MIN(5.0, strength + ?),
			updated_at = ?
	`, sourceID, targetID, linkType, delta, now, now, delta, now)
	if err != nil {
		return fmt.Errorf("create or strengthen link: %w", err)
	}
	return nil
}

// GetLinked returns memories linked to the given memory ID, ordered by strength.
func (s *LinkStore) GetLinked(id string, limit int) ([]MemoryLink, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.db.Query(`
		SELECT id, source_id, target_id, link_type, strength, created_at, updated_at
		FROM memory_links
		WHERE source_id = ? OR target_id = ?
		ORDER BY strength DESC
		LIMIT ?
	`, id, id, limit)
	if err != nil {
		return nil, fmt.Errorf("get linked memories: %w", err)
	}
	defer rows.Close()

	var links []MemoryLink
	for rows.Next() {
		var l MemoryLink
		if err := rows.Scan(&l.ID, &l.SourceID, &l.TargetID, &l.LinkType, &l.Strength, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan link: %w", err)
		}
		links = append(links, l)
	}
	return links, rows.Err()
}
