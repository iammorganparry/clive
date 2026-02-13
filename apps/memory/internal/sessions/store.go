package sessions

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
)

// SessionStore handles Session CRUD on SQLite.
type SessionStore struct {
	db *store.DB
}

// NewSessionStore creates a new session store.
func NewSessionStore(db *store.DB) *SessionStore {
	return &SessionStore{db: db}
}

// EnsureSession creates a session if it doesn't exist, or returns the existing one.
func (s *SessionStore) EnsureSession(sessionID, workspaceID string) (*models.Session, error) {
	existing, err := s.GetByID(sessionID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	now := time.Now().Unix()
	_, err = s.db.Exec(`
		INSERT INTO sessions (id, workspace_id, started_at, prompt_count)
		VALUES (?, ?, ?, 0)
	`, sessionID, workspaceID, now)
	if err != nil {
		return nil, fmt.Errorf("insert session: %w", err)
	}

	return &models.Session{
		ID:          sessionID,
		WorkspaceID: workspaceID,
		StartedAt:   now,
		PromptCount: 0,
	}, nil
}

// GetByID fetches a session by ID.
func (s *SessionStore) GetByID(id string) (*models.Session, error) {
	var sess models.Session
	var endedAt sql.NullInt64
	var summaryMemoryID sql.NullString

	err := s.db.QueryRow(`
		SELECT id, workspace_id, started_at, ended_at, summary_memory_id, prompt_count
		FROM sessions WHERE id = ?
	`, id).Scan(&sess.ID, &sess.WorkspaceID, &sess.StartedAt, &endedAt, &summaryMemoryID, &sess.PromptCount)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}

	if endedAt.Valid {
		sess.EndedAt = &endedAt.Int64
	}
	if summaryMemoryID.Valid {
		sess.SummaryMemoryID = summaryMemoryID.String
	}
	return &sess, nil
}

// EndSession marks a session as ended.
func (s *SessionStore) EndSession(id string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`UPDATE sessions SET ended_at = ? WHERE id = ?`, now, id)
	return err
}

// SetSummaryMemory links a summary memory to a session.
func (s *SessionStore) SetSummaryMemory(sessionID, memoryID string) error {
	_, err := s.db.Exec(`UPDATE sessions SET summary_memory_id = ? WHERE id = ?`, memoryID, sessionID)
	return err
}

// IncrementPromptCount bumps the prompt count for a session.
func (s *SessionStore) IncrementPromptCount(id string) error {
	_, err := s.db.Exec(`UPDATE sessions SET prompt_count = prompt_count + 1 WHERE id = ?`, id)
	return err
}

// List returns recent sessions for a workspace, ordered by start time desc.
func (s *SessionStore) List(workspaceID string, limit int) ([]*models.Session, error) {
	if limit <= 0 {
		limit = 20
	}

	rows, err := s.db.Query(`
		SELECT id, workspace_id, started_at, ended_at, summary_memory_id, prompt_count
		FROM sessions
		WHERE workspace_id = ?
		ORDER BY started_at DESC
		LIMIT ?
	`, workspaceID, limit)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []*models.Session
	for rows.Next() {
		var sess models.Session
		var endedAt sql.NullInt64
		var summaryMemoryID sql.NullString

		if err := rows.Scan(&sess.ID, &sess.WorkspaceID, &sess.StartedAt, &endedAt, &summaryMemoryID, &sess.PromptCount); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		if endedAt.Valid {
			sess.EndedAt = &endedAt.Int64
		}
		if summaryMemoryID.Valid {
			sess.SummaryMemoryID = summaryMemoryID.String
		}
		sessions = append(sessions, &sess)
	}
	return sessions, rows.Err()
}
