package sessions

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/anthropics/clive/apps/memory/internal/models"
	"github.com/anthropics/clive/apps/memory/internal/privacy"
	"github.com/anthropics/clive/apps/memory/internal/store"
)

// ObservationStore handles Observation CRUD on SQLite.
type ObservationStore struct {
	db *store.DB
}

// NewObservationStore creates a new observation store.
func NewObservationStore(db *store.DB) *ObservationStore {
	return &ObservationStore{db: db}
}

// Insert stores a new observation, applying privacy filtering to input/output.
func (s *ObservationStore) Insert(sessionID string, req *models.StoreObservationRequest) (*models.Observation, error) {
	// Get current sequence number
	var seq int
	err := s.db.QueryRow(`SELECT COALESCE(MAX(sequence), 0) + 1 FROM observations WHERE session_id = ?`, sessionID).Scan(&seq)
	if err != nil {
		return nil, fmt.Errorf("get sequence: %w", err)
	}

	id := uuid.New().String()
	now := time.Now().Unix()

	// Apply privacy filter to input/output
	input := truncateStr(privacy.StripPrivateTags(req.Input), 500)
	output := truncateStr(privacy.StripPrivateTags(req.Output), 200)

	successInt := 1
	if !req.Success {
		successInt = 0
	}

	_, err = s.db.Exec(`
		INSERT INTO observations (id, session_id, tool_name, input, output, success, created_at, sequence)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, id, sessionID, req.ToolName, input, output, successInt, now, seq)
	if err != nil {
		return nil, fmt.Errorf("insert observation: %w", err)
	}

	return &models.Observation{
		ID:        id,
		SessionID: sessionID,
		ToolName:  req.ToolName,
		Input:     input,
		Output:    output,
		Success:   req.Success,
		CreatedAt: now,
		Sequence:  seq,
	}, nil
}

// ListBySession returns all observations for a session, ordered by sequence.
func (s *ObservationStore) ListBySession(sessionID string, limit int) ([]*models.Observation, error) {
	if limit <= 0 {
		limit = 100
	}

	rows, err := s.db.Query(`
		SELECT id, session_id, tool_name, input, output, success, created_at, sequence
		FROM observations
		WHERE session_id = ?
		ORDER BY sequence ASC
		LIMIT ?
	`, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("list observations: %w", err)
	}
	defer rows.Close()

	var observations []*models.Observation
	for rows.Next() {
		var obs models.Observation
		var successInt int
		if err := rows.Scan(&obs.ID, &obs.SessionID, &obs.ToolName, &obs.Input, &obs.Output, &successInt, &obs.CreatedAt, &obs.Sequence); err != nil {
			return nil, fmt.Errorf("scan observation: %w", err)
		}
		obs.Success = successInt == 1
		observations = append(observations, &obs)
	}
	return observations, rows.Err()
}

// FormatForSummary returns a compact text representation of observations for the summarizer.
func (s *ObservationStore) FormatForSummary(sessionID string) (string, error) {
	observations, err := s.ListBySession(sessionID, 200)
	if err != nil {
		return "", err
	}

	if len(observations) == 0 {
		return "", nil
	}

	var result string
	for _, obs := range observations {
		status := "OK"
		if !obs.Success {
			status = "FAIL"
		}
		result += fmt.Sprintf("[%d] %s %s: %s → %s\n", obs.Sequence, status, obs.ToolName,
			truncateStr(obs.Input, 80), truncateStr(obs.Output, 80))
	}
	return result, nil
}

// truncateStr truncates a string to maxLen, appending "..." if truncated.
func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
