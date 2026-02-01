package store

import (
	"fmt"
	"strings"
)

// BM25Result holds an FTS5 match result.
type BM25Result struct {
	RowID int64
	ID    string
	Rank  float64
}

// BM25Store handles full-text search via SQLite FTS5.
type BM25Store struct {
	db *DB
}

func NewBM25Store(db *DB) *BM25Store {
	return &BM25Store{db: db}
}

// Search performs BM25 full-text search, scoped to a set of workspace IDs.
// Returns memory IDs ranked by BM25 score (lower rank = better match).
func (s *BM25Store) Search(query string, workspaceIDs []string, limit int) ([]BM25Result, error) {
	if query == "" || len(workspaceIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(workspaceIDs))
	args := make([]any, 0, len(workspaceIDs)+2)
	args = append(args, query)
	for i, id := range workspaceIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	args = append(args, limit)

	// Join FTS5 results back to memories table for workspace filtering.
	// bm25() returns negative values where more negative = better match,
	// so we negate to get positive scores where higher = better.
	q := fmt.Sprintf(`
		SELECT m.rowid, m.id, -rank AS score
		FROM memories_fts
		JOIN memories m ON m.rowid = memories_fts.rowid
		WHERE memories_fts MATCH ?
		  AND m.workspace_id IN (%s)
		ORDER BY rank
		LIMIT ?
	`, strings.Join(placeholders, ","))

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("bm25 search: %w", err)
	}
	defer rows.Close()

	var results []BM25Result
	for rows.Next() {
		var r BM25Result
		if err := rows.Scan(&r.RowID, &r.ID, &r.Rank); err != nil {
			return nil, fmt.Errorf("scan bm25 result: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}
