package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
)

// ThreadStore handles CRUD operations for feature threads and their entries.
type ThreadStore struct {
	db *DB
}

func NewThreadStore(db *DB) *ThreadStore {
	return &ThreadStore{db: db}
}

// CreateThread inserts a new feature thread.
func (s *ThreadStore) CreateThread(t *models.FeatureThread) error {
	relatedFilesJSON, _ := json.Marshal(t.RelatedFiles)
	tagsJSON, _ := json.Marshal(t.Tags)

	_, err := s.db.Exec(`
		INSERT INTO feature_threads (
			id, workspace_id, name, description, status,
			created_at, updated_at, entry_count, token_budget,
			summary, related_files, tags
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		t.ID, t.WorkspaceID, t.Name, t.Description, string(t.Status),
		t.CreatedAt, t.UpdatedAt, t.EntryCount, t.TokenBudget,
		t.Summary, string(relatedFilesJSON), string(tagsJSON),
	)
	if err != nil {
		return fmt.Errorf("insert thread: %w", err)
	}
	return nil
}

// GetThread fetches a thread by ID.
func (s *ThreadStore) GetThread(id string) (*models.FeatureThread, error) {
	t, err := s.scanThread(s.db.QueryRow(`
		SELECT id, workspace_id, name, description, status,
			created_at, updated_at, closed_at, entry_count, token_budget,
			summary, related_files, tags
		FROM feature_threads WHERE id = ?
	`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

// GetThreadByName fetches a thread by name within a workspace.
func (s *ThreadStore) GetThreadByName(workspaceID, name string) (*models.FeatureThread, error) {
	t, err := s.scanThread(s.db.QueryRow(`
		SELECT id, workspace_id, name, description, status,
			created_at, updated_at, closed_at, entry_count, token_budget,
			summary, related_files, tags
		FROM feature_threads WHERE workspace_id = ? AND name = ?
	`, workspaceID, name))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

// ListThreads returns threads filtered by workspace, status, and/or name.
func (s *ThreadStore) ListThreads(workspaceID string, status models.ThreadStatus, name string) ([]*models.FeatureThread, error) {
	var conditions []string
	var args []any

	if workspaceID != "" {
		conditions = append(conditions, "workspace_id = ?")
		args = append(args, workspaceID)
	}
	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, string(status))
	}
	if name != "" {
		conditions = append(conditions, "name = ?")
		args = append(args, name)
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	rows, err := s.db.Query(fmt.Sprintf(`
		SELECT id, workspace_id, name, description, status,
			created_at, updated_at, closed_at, entry_count, token_budget,
			summary, related_files, tags
		FROM feature_threads %s ORDER BY updated_at DESC
	`, where), args...)
	if err != nil {
		return nil, fmt.Errorf("list threads: %w", err)
	}
	defer rows.Close()
	return s.scanThreads(rows)
}

// UpdateThread applies partial updates to a thread.
func (s *ThreadStore) UpdateThread(id string, req *models.UpdateThreadRequest) (*models.FeatureThread, error) {
	sets := []string{"updated_at = ?"}
	args := []any{time.Now().Unix()}

	if req.Status != nil {
		sets = append(sets, "status = ?")
		args = append(args, string(*req.Status))
		if *req.Status == models.ThreadStatusClosed {
			now := time.Now().Unix()
			sets = append(sets, "closed_at = ?")
			args = append(args, now)
		}
	}
	if req.Summary != nil {
		sets = append(sets, "summary = ?")
		args = append(args, *req.Summary)
	}
	if req.TokenBudget != nil {
		sets = append(sets, "token_budget = ?")
		args = append(args, *req.TokenBudget)
	}
	if req.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *req.Description)
	}
	if req.RelatedFiles != nil {
		filesJSON, _ := json.Marshal(*req.RelatedFiles)
		sets = append(sets, "related_files = ?")
		args = append(args, string(filesJSON))
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(*req.Tags)
		sets = append(sets, "tags = ?")
		args = append(args, string(tagsJSON))
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE feature_threads SET %s WHERE id = ?", strings.Join(sets, ", "))
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update thread: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("thread not found: %s", id)
	}

	return s.GetThread(id)
}

// DeleteThread removes a thread and its entries (cascading).
func (s *ThreadStore) DeleteThread(id string) error {
	// Clear thread_id on associated memories first
	_, err := s.db.Exec(`UPDATE memories SET thread_id = NULL WHERE thread_id = ?`, id)
	if err != nil {
		return fmt.Errorf("clear memory thread_ids: %w", err)
	}

	res, err := s.db.Exec("DELETE FROM feature_threads WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete thread: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("thread not found: %s", id)
	}
	return nil
}

// AppendEntry adds a new entry to a thread and increments entry_count.
func (s *ThreadStore) AppendEntry(entry *models.ThreadEntry) error {
	_, err := s.db.Exec(`
		INSERT INTO thread_entries (id, thread_id, memory_id, sequence, section, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, entry.ID, entry.ThreadID, entry.MemoryID, entry.Sequence, string(entry.Section), entry.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert thread entry: %w", err)
	}

	// Increment entry count and update timestamp
	now := time.Now().Unix()
	_, err = s.db.Exec(`
		UPDATE feature_threads SET entry_count = entry_count + 1, updated_at = ?
		WHERE id = ?
	`, now, entry.ThreadID)
	if err != nil {
		return fmt.Errorf("update thread entry count: %w", err)
	}

	return nil
}

// GetEntries returns all entries for a thread, ordered by sequence, with memory content joined.
func (s *ThreadStore) GetEntries(threadID string) ([]models.ThreadEntry, error) {
	rows, err := s.db.Query(`
		SELECT te.id, te.thread_id, te.memory_id, te.sequence, te.section, te.created_at,
			m.content, m.memory_type
		FROM thread_entries te
		JOIN memories m ON te.memory_id = m.id
		WHERE te.thread_id = ?
		ORDER BY te.sequence ASC
	`, threadID)
	if err != nil {
		return nil, fmt.Errorf("get entries: %w", err)
	}
	defer rows.Close()

	var entries []models.ThreadEntry
	for rows.Next() {
		var e models.ThreadEntry
		if err := rows.Scan(
			&e.ID, &e.ThreadID, &e.MemoryID, &e.Sequence, &e.Section, &e.CreatedAt,
			&e.Content, &e.MemoryType,
		); err != nil {
			return nil, fmt.Errorf("scan entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// GetEntriesBySection returns entries for a thread filtered by section.
func (s *ThreadStore) GetEntriesBySection(threadID string, section models.ThreadSection) ([]models.ThreadEntry, error) {
	rows, err := s.db.Query(`
		SELECT te.id, te.thread_id, te.memory_id, te.sequence, te.section, te.created_at,
			m.content, m.memory_type
		FROM thread_entries te
		JOIN memories m ON te.memory_id = m.id
		WHERE te.thread_id = ? AND te.section = ?
		ORDER BY te.sequence ASC
	`, threadID, string(section))
	if err != nil {
		return nil, fmt.Errorf("get entries by section: %w", err)
	}
	defer rows.Close()

	var entries []models.ThreadEntry
	for rows.Next() {
		var e models.ThreadEntry
		if err := rows.Scan(
			&e.ID, &e.ThreadID, &e.MemoryID, &e.Sequence, &e.Section, &e.CreatedAt,
			&e.Content, &e.MemoryType,
		); err != nil {
			return nil, fmt.Errorf("scan entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// NextSequence returns the next sequence number for a thread.
func (s *ThreadStore) NextSequence(threadID string) (int, error) {
	var maxSeq sql.NullInt64
	err := s.db.QueryRow(`
		SELECT MAX(sequence) FROM thread_entries WHERE thread_id = ?
	`, threadID).Scan(&maxSeq)
	if err != nil {
		return 1, nil
	}
	if !maxSeq.Valid {
		return 1, nil
	}
	return int(maxSeq.Int64) + 1, nil
}

// GetActiveThreadIDs returns IDs of all active threads.
func (s *ThreadStore) GetActiveThreadIDs() ([]string, error) {
	rows, err := s.db.Query(`SELECT id FROM feature_threads WHERE status = 'active'`)
	if err != nil {
		return nil, fmt.Errorf("get active thread ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan thread id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *ThreadStore) scanThread(row *sql.Row) (*models.FeatureThread, error) {
	var t models.FeatureThread
	var closedAt sql.NullInt64
	var relatedFilesJSON, tagsJSON sql.NullString

	err := row.Scan(
		&t.ID, &t.WorkspaceID, &t.Name, &t.Description, &t.Status,
		&t.CreatedAt, &t.UpdatedAt, &closedAt, &t.EntryCount, &t.TokenBudget,
		&t.Summary, &relatedFilesJSON, &tagsJSON,
	)
	if err != nil {
		return nil, err
	}

	if closedAt.Valid {
		t.ClosedAt = &closedAt.Int64
	}
	if relatedFilesJSON.Valid {
		json.Unmarshal([]byte(relatedFilesJSON.String), &t.RelatedFiles)
	}
	if tagsJSON.Valid {
		json.Unmarshal([]byte(tagsJSON.String), &t.Tags)
	}

	return &t, nil
}

func (s *ThreadStore) scanThreads(rows *sql.Rows) ([]*models.FeatureThread, error) {
	var result []*models.FeatureThread
	for rows.Next() {
		var t models.FeatureThread
		var closedAt sql.NullInt64
		var relatedFilesJSON, tagsJSON sql.NullString

		if err := rows.Scan(
			&t.ID, &t.WorkspaceID, &t.Name, &t.Description, &t.Status,
			&t.CreatedAt, &t.UpdatedAt, &closedAt, &t.EntryCount, &t.TokenBudget,
			&t.Summary, &relatedFilesJSON, &tagsJSON,
		); err != nil {
			return nil, fmt.Errorf("scan thread: %w", err)
		}

		if closedAt.Valid {
			t.ClosedAt = &closedAt.Int64
		}
		if relatedFilesJSON.Valid {
			json.Unmarshal([]byte(relatedFilesJSON.String), &t.RelatedFiles)
		}
		if tagsJSON.Valid {
			json.Unmarshal([]byte(tagsJSON.String), &t.Tags)
		}

		result = append(result, &t)
	}
	return result, rows.Err()
}
