package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/anthropics/clive/apps/memory/internal/models"
)

// memoryColumns is the canonical column list for all SELECT queries.
// Order must match scanOne/scanMany.
const memoryColumns = `id, workspace_id, content, memory_type, tier, confidence,
	access_count, tags, source, session_id, content_hash,
	embedding, embedding_model, created_at, updated_at, expires_at,
	impact_score, related_files,
	stability, last_accessed_at,
	encoding_context,
	superseded_by,
	completion_status`

// MemoryStore handles Memory CRUD operations on SQLite.
type MemoryStore struct {
	db *DB
}

func NewMemoryStore(db *DB) *MemoryStore {
	return &MemoryStore{db: db}
}

// Insert stores a new memory. The caller must set all required fields including ID and ContentHash.
func (s *MemoryStore) Insert(m *models.Memory) error {
	tagsJSON, _ := json.Marshal(m.Tags)
	relatedFilesJSON, _ := json.Marshal(m.RelatedFiles)

	var encodingCtxJSON []byte
	if m.EncodingContext != nil {
		encodingCtxJSON, _ = json.Marshal(m.EncodingContext)
	}

	_, err := s.db.Exec(`
		INSERT INTO memories (
			id, workspace_id, content, memory_type, tier, confidence,
			access_count, tags, source, session_id, content_hash,
			embedding, embedding_model, created_at, updated_at, expires_at,
			impact_score, related_files,
			stability, last_accessed_at,
			encoding_context,
			superseded_by,
			completion_status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		m.ID, m.WorkspaceID, m.Content, string(m.MemoryType), string(m.Tier),
		m.Confidence, m.AccessCount, string(tagsJSON), m.Source, m.SessionID,
		m.ContentHash, m.Embedding, m.EmbeddingModel,
		m.CreatedAt, m.UpdatedAt, m.ExpiresAt,
		m.ImpactScore, string(relatedFilesJSON),
		m.Stability, m.LastAccessedAt,
		nullableString(encodingCtxJSON),
		m.SupersededBy,
		m.CompletionStatus,
	)
	if err != nil {
		return fmt.Errorf("insert memory: %w", err)
	}
	return nil
}

// GetByID fetches a single memory by ID.
func (s *MemoryStore) GetByID(id string) (*models.Memory, error) {
	m, err := s.scanOne(s.db.QueryRow(
		fmt.Sprintf(`SELECT %s FROM memories WHERE id = ?`, memoryColumns), id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return m, err
}

// Delete removes a memory by ID.
func (s *MemoryStore) Delete(id string) error {
	res, err := s.db.Exec("DELETE FROM memories WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete memory: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("memory not found: %s", id)
	}
	return nil
}

// Update applies partial updates to a memory.
func (s *MemoryStore) Update(id string, req *models.UpdateRequest) (*models.Memory, error) {
	sets := []string{"updated_at = ?"}
	args := []any{time.Now().Unix()}

	if req.Tier != nil {
		sets = append(sets, "tier = ?")
		args = append(args, string(*req.Tier))
	}
	if req.Confidence != nil {
		sets = append(sets, "confidence = ?")
		args = append(args, *req.Confidence)
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(*req.Tags)
		sets = append(sets, "tags = ?")
		args = append(args, string(tagsJSON))
	}
	if req.Content != nil {
		sets = append(sets, "content = ?")
		args = append(args, *req.Content)
	}
	if req.MemoryType != nil {
		sets = append(sets, "memory_type = ?")
		args = append(args, string(*req.MemoryType))
	}
	if req.CompletionStatus != nil {
		sets = append(sets, "completion_status = ?")
		args = append(args, *req.CompletionStatus)
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE memories SET %s WHERE id = ?", strings.Join(sets, ", "))
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update memory: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("memory not found: %s", id)
	}

	return s.GetByID(id)
}

// FindByContentHash finds memories with the given content hash in a workspace.
func (s *MemoryStore) FindByContentHash(workspaceID, hash string) ([]*models.Memory, error) {
	rows, err := s.db.Query(
		fmt.Sprintf(`SELECT %s FROM memories WHERE workspace_id = ? AND content_hash = ?`, memoryColumns),
		workspaceID, hash)
	if err != nil {
		return nil, fmt.Errorf("find by hash: %w", err)
	}
	defer rows.Close()
	return s.scanMany(rows)
}

// GetShortTermWithEmbeddings returns all short-term memories with embeddings
// for a set of workspace IDs (used for brute-force cosine search).
func (s *MemoryStore) GetShortTermWithEmbeddings(workspaceIDs []string) ([]*models.Memory, error) {
	if len(workspaceIDs) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(workspaceIDs))
	args := make([]any, len(workspaceIDs))
	for i, id := range workspaceIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT %s
		FROM memories
		WHERE workspace_id IN (%s) AND tier = 'short' AND embedding IS NOT NULL
	`, memoryColumns, strings.Join(placeholders, ","))

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("get short-term: %w", err)
	}
	defer rows.Close()
	return s.scanMany(rows)
}

// IncrementAccessCount bumps a memory's access count and last_accessed_at timestamp.
func (s *MemoryStore) IncrementAccessCount(id string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ?
		WHERE id = ?
	`, now, now, id)
	return err
}

// UpdateStabilityOnAccess reinforces a memory's stability using the FSRS-inspired formula:
// stability = MIN(365, stability × (1 + 0.5 × (1 + impact_score)))
func (s *MemoryStore) UpdateStabilityOnAccess(id string, impactScore float64) error {
	_, err := s.db.Exec(`
		UPDATE memories SET stability = MIN(365.0, stability * (1.0 + 0.5 * (1.0 + ?)))
		WHERE id = ?
	`, impactScore, id)
	return err
}

// GetAllShortTerm returns all short-term memories (for retrievability-based cleanup).
func (s *MemoryStore) GetAllShortTerm() ([]*models.Memory, error) {
	rows, err := s.db.Query(
		fmt.Sprintf(`SELECT %s FROM memories WHERE tier = 'short'`, memoryColumns))
	if err != nil {
		return nil, fmt.Errorf("get all short-term: %w", err)
	}
	defer rows.Close()
	return s.scanMany(rows)
}

// Supersede marks an old memory as superseded by a new memory.
func (s *MemoryStore) Supersede(oldID, newID string) error {
	now := time.Now().Unix()
	res, err := s.db.Exec(`
		UPDATE memories SET superseded_by = ?, updated_at = ?
		WHERE id = ? AND superseded_by IS NULL
	`, newID, now, oldID)
	if err != nil {
		return fmt.Errorf("supersede memory: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("memory not found or already superseded: %s", oldID)
	}
	return nil
}

// ClearEmbedding sets embedding to NULL (used when promoting to Qdrant).
func (s *MemoryStore) ClearEmbedding(id string) error {
	_, err := s.db.Exec(`
		UPDATE memories SET embedding = NULL, updated_at = ?
		WHERE id = ?
	`, time.Now().Unix(), id)
	return err
}

// SetTier updates the tier and expires_at for a memory.
func (s *MemoryStore) SetTier(id string, tier models.Tier, expiresAt *int64) error {
	_, err := s.db.Exec(`
		UPDATE memories SET tier = ?, expires_at = ?, updated_at = ?
		WHERE id = ?
	`, string(tier), expiresAt, time.Now().Unix(), id)
	return err
}

// DeleteExpired removes all memories whose expires_at has passed.
func (s *MemoryStore) DeleteExpired() (int64, error) {
	res, err := s.db.Exec(`
		DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?
	`, time.Now().Unix())
	if err != nil {
		return 0, fmt.Errorf("delete expired: %w", err)
	}
	return res.RowsAffected()
}

// GetPromotionCandidates returns short-term memories eligible for promotion.
func (s *MemoryStore) GetPromotionCandidates(minAccess int, minConfidence float64) ([]*models.Memory, error) {
	rows, err := s.db.Query(
		fmt.Sprintf(`SELECT %s FROM memories WHERE tier = 'short' AND access_count >= ? AND confidence >= ?`, memoryColumns),
		minAccess, minConfidence)
	if err != nil {
		return nil, fmt.Errorf("get promotion candidates: %w", err)
	}
	defer rows.Close()
	return s.scanMany(rows)
}

// DeleteByTypeAndWorkspace removes all memories matching a type and workspace.
// Returns the IDs of deleted memories so callers can clean up Qdrant points.
func (s *MemoryStore) DeleteByTypeAndWorkspace(memoryType string, workspaceID string) ([]string, error) {
	// First, collect the IDs so we can return them for Qdrant cleanup
	rows, err := s.db.Query(
		`SELECT id FROM memories WHERE memory_type = ? AND workspace_id = ?`,
		memoryType, workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("query memories for delete: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan memory id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate memory ids: %w", err)
	}

	if len(ids) == 0 {
		return nil, nil
	}

	// Delete all matching memories
	_, err = s.db.Exec(
		`DELETE FROM memories WHERE memory_type = ? AND workspace_id = ?`,
		memoryType, workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("delete memories by type: %w", err)
	}

	return ids, nil
}

// List returns a paginated, filtered, sorted list of memories.
func (s *MemoryStore) List(req *models.ListRequest) ([]*models.Memory, int, error) {
	// Whitelist sort columns to prevent injection
	allowedSorts := map[string]string{
		"created_at":   "created_at",
		"updated_at":   "updated_at",
		"confidence":   "confidence",
		"access_count": "access_count",
		"impact_score": "impact_score",
		"stability":    "stability",
	}
	sortCol, ok := allowedSorts[req.Sort]
	if !ok {
		sortCol = "created_at"
	}

	order := "DESC"
	if req.Order == "asc" {
		order = "ASC"
	}

	// Build WHERE clause dynamically
	var conditions []string
	var args []any

	if req.WorkspaceID != "" {
		conditions = append(conditions, "workspace_id = ?")
		args = append(args, req.WorkspaceID)
	}
	if len(req.MemoryTypes) > 0 {
		placeholders := make([]string, len(req.MemoryTypes))
		for i, mt := range req.MemoryTypes {
			placeholders[i] = "?"
			args = append(args, string(mt))
		}
		conditions = append(conditions, fmt.Sprintf("memory_type IN (%s)", strings.Join(placeholders, ",")))
	}
	if req.Tier != "" {
		conditions = append(conditions, "tier = ?")
		args = append(args, req.Tier)
	}
	if req.Source != "" {
		conditions = append(conditions, "source = ?")
		args = append(args, req.Source)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM memories %s", whereClause)
	var total int
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count memories: %w", err)
	}

	// Paginate
	limit := req.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	page := req.Page
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	selectQuery := fmt.Sprintf(`
		SELECT %s
		FROM memories %s
		ORDER BY %s %s
		LIMIT ? OFFSET ?
	`, memoryColumns, whereClause, sortCol, order)

	queryArgs := append(args, limit, offset)
	rows, err := s.db.Query(selectQuery, queryArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list memories: %w", err)
	}
	defer rows.Close()

	memories, err := s.scanMany(rows)
	if err != nil {
		return nil, 0, err
	}

	return memories, total, nil
}

// CountByWorkspace returns per-type counts for a workspace.
func (s *MemoryStore) CountByWorkspace(workspaceID string) (total, shortTerm, longTerm int, byType map[string]int, err error) {
	byType = make(map[string]int)

	err = s.db.QueryRow(`SELECT COUNT(*) FROM memories WHERE workspace_id = ?`, workspaceID).Scan(&total)
	if err != nil {
		return
	}
	err = s.db.QueryRow(`SELECT COUNT(*) FROM memories WHERE workspace_id = ? AND tier = 'short'`, workspaceID).Scan(&shortTerm)
	if err != nil {
		return
	}
	err = s.db.QueryRow(`SELECT COUNT(*) FROM memories WHERE workspace_id = ? AND tier = 'long'`, workspaceID).Scan(&longTerm)
	if err != nil {
		return
	}

	rows, err := s.db.Query(`SELECT memory_type, COUNT(*) FROM memories WHERE workspace_id = ? GROUP BY memory_type`, workspaceID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var mt string
		var c int
		if err = rows.Scan(&mt, &c); err != nil {
			return
		}
		byType[mt] = c
	}
	err = rows.Err()
	return
}

// RecordImpact inserts an impact event and increments the memory's impact_score.
func (s *MemoryStore) RecordImpact(memoryID string, signal models.ImpactSignal, source, sessionID string) (float64, error) {
	delta, ok := models.SignalDeltas[signal]
	if !ok {
		return 0, fmt.Errorf("unknown signal: %s", signal)
	}

	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO memory_impacts (memory_id, signal, source, session_id, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, memoryID, string(signal), source, sessionID, now)
	if err != nil {
		return 0, fmt.Errorf("insert impact event: %w", err)
	}

	_, err = s.db.Exec(`
		UPDATE memories SET impact_score = MIN(1.0, impact_score + ?), updated_at = ?
		WHERE id = ?
	`, delta, now, memoryID)
	if err != nil {
		return 0, fmt.Errorf("update impact score: %w", err)
	}

	var score float64
	err = s.db.QueryRow(`SELECT impact_score FROM memories WHERE id = ?`, memoryID).Scan(&score)
	if err != nil {
		return 0, fmt.Errorf("read impact score: %w", err)
	}

	return score, nil
}

// GetImpactEvents returns all impact events for a memory, ordered by creation time.
func (s *MemoryStore) GetImpactEvents(memoryID string) ([]models.ImpactEvent, error) {
	rows, err := s.db.Query(`
		SELECT id, memory_id, signal, source, session_id, created_at
		FROM memory_impacts
		WHERE memory_id = ?
		ORDER BY created_at DESC
	`, memoryID)
	if err != nil {
		return nil, fmt.Errorf("get impact events: %w", err)
	}
	defer rows.Close()

	var events []models.ImpactEvent
	for rows.Next() {
		var e models.ImpactEvent
		var sessionID sql.NullString
		if err := rows.Scan(&e.ID, &e.MemoryID, &e.Signal, &e.Source, &sessionID, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan impact event: %w", err)
		}
		if sessionID.Valid {
			e.SessionID = sessionID.String
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// GetImpactLeaders returns top memories by impact_score for a workspace.
func (s *MemoryStore) GetImpactLeaders(workspaceID string, limit int) ([]*models.Memory, error) {
	if limit <= 0 {
		limit = 10
	}

	query := fmt.Sprintf(`
		SELECT %s
		FROM memories
		WHERE impact_score > 0
	`, memoryColumns)
	args := []any{}

	if workspaceID != "" {
		query += ` AND workspace_id = ?`
		args = append(args, workspaceID)
	}

	query += ` ORDER BY impact_score DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("get impact leaders: %w", err)
	}
	defer rows.Close()
	return s.scanMany(rows)
}

// GetImpactPromotionCandidates returns short-term memories with impact >= threshold.
func (s *MemoryStore) GetImpactPromotionCandidates(minImpact float64) ([]*models.Memory, error) {
	rows, err := s.db.Query(
		fmt.Sprintf(`SELECT %s FROM memories WHERE tier = 'short' AND impact_score >= ?`, memoryColumns),
		minImpact)
	if err != nil {
		return nil, fmt.Errorf("get impact promotion candidates: %w", err)
	}
	defer rows.Close()
	return s.scanMany(rows)
}

// GetByIDs fetches multiple memories by their IDs in a single query.
func (s *MemoryStore) GetByIDs(ids []string) ([]*models.Memory, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf(`SELECT %s FROM memories WHERE id IN (%s)`,
		memoryColumns, strings.Join(placeholders, ","))
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("get by ids: %w", err)
	}
	defer rows.Close()
	return s.scanMany(rows)
}

// GetTimelineAround returns memories created around the same time as the anchor memory.
// It queries by session_id first (if available), falling back to a time window.
func (s *MemoryStore) GetTimelineAround(anchorID string, windowMinutes int, maxResults int) (before []*models.Memory, after []*models.Memory, err error) {
	if maxResults <= 0 {
		maxResults = 5
	}
	if windowMinutes <= 0 {
		windowMinutes = 30
	}

	anchor, err := s.GetByID(anchorID)
	if err != nil || anchor == nil {
		return nil, nil, fmt.Errorf("anchor memory not found: %s", anchorID)
	}

	windowSecs := int64(windowMinutes * 60)
	startTime := anchor.CreatedAt - windowSecs
	endTime := anchor.CreatedAt + windowSecs

	// Try session-based timeline first
	if anchor.SessionID != "" {
		beforeRows, err := s.db.Query(
			fmt.Sprintf(`SELECT %s FROM memories WHERE session_id = ? AND created_at < ? AND id != ? ORDER BY created_at DESC LIMIT ?`,
				memoryColumns),
			anchor.SessionID, anchor.CreatedAt, anchorID, maxResults)
		if err == nil {
			defer beforeRows.Close()
			before, _ = s.scanMany(beforeRows)
		}

		afterRows, err := s.db.Query(
			fmt.Sprintf(`SELECT %s FROM memories WHERE session_id = ? AND created_at > ? AND id != ? ORDER BY created_at ASC LIMIT ?`,
				memoryColumns),
			anchor.SessionID, anchor.CreatedAt, anchorID, maxResults)
		if err == nil {
			defer afterRows.Close()
			after, _ = s.scanMany(afterRows)
		}

		if len(before)+len(after) > 0 {
			return before, after, nil
		}
	}

	// Fallback: time-window based
	beforeRows, err := s.db.Query(
		fmt.Sprintf(`SELECT %s FROM memories WHERE workspace_id = ? AND created_at >= ? AND created_at < ? AND id != ? ORDER BY created_at DESC LIMIT ?`,
			memoryColumns),
		anchor.WorkspaceID, startTime, anchor.CreatedAt, anchorID, maxResults)
	if err != nil {
		return nil, nil, fmt.Errorf("timeline before: %w", err)
	}
	defer beforeRows.Close()
	before, err = s.scanMany(beforeRows)
	if err != nil {
		return nil, nil, err
	}

	afterRows, err := s.db.Query(
		fmt.Sprintf(`SELECT %s FROM memories WHERE workspace_id = ? AND created_at > ? AND created_at <= ? AND id != ? ORDER BY created_at ASC LIMIT ?`,
			memoryColumns),
		anchor.WorkspaceID, anchor.CreatedAt, endTime, anchorID, maxResults)
	if err != nil {
		return nil, nil, fmt.Errorf("timeline after: %w", err)
	}
	defer afterRows.Close()
	after, err = s.scanMany(afterRows)
	if err != nil {
		return nil, nil, err
	}

	return before, after, nil
}

func (s *MemoryStore) scanOne(row *sql.Row) (*models.Memory, error) {
	var m models.Memory
	var tagsJSON sql.NullString
	var source, sessionID, embModel sql.NullString
	var expiresAt sql.NullInt64
	var relatedFilesJSON sql.NullString
	var lastAccessedAt sql.NullInt64
	var encodingCtxJSON sql.NullString
	var supersededBy sql.NullString
	var completionStatus sql.NullString

	err := row.Scan(
		&m.ID, &m.WorkspaceID, &m.Content, &m.MemoryType, &m.Tier,
		&m.Confidence, &m.AccessCount, &tagsJSON, &source, &sessionID,
		&m.ContentHash, &m.Embedding, &embModel,
		&m.CreatedAt, &m.UpdatedAt, &expiresAt,
		&m.ImpactScore, &relatedFilesJSON,
		&m.Stability, &lastAccessedAt,
		&encodingCtxJSON,
		&supersededBy,
		&completionStatus,
	)
	if err != nil {
		return nil, err
	}

	populateMemoryNullables(&m, tagsJSON, source, sessionID, embModel, expiresAt,
		relatedFilesJSON, lastAccessedAt, encodingCtxJSON, supersededBy, completionStatus)

	return &m, nil
}

func (s *MemoryStore) scanMany(rows *sql.Rows) ([]*models.Memory, error) {
	var result []*models.Memory
	for rows.Next() {
		var m models.Memory
		var tagsJSON sql.NullString
		var source, sessionID, embModel sql.NullString
		var expiresAt sql.NullInt64
		var relatedFilesJSON sql.NullString
		var lastAccessedAt sql.NullInt64
		var encodingCtxJSON sql.NullString
		var supersededBy sql.NullString
		var completionStatus sql.NullString

		if err := rows.Scan(
			&m.ID, &m.WorkspaceID, &m.Content, &m.MemoryType, &m.Tier,
			&m.Confidence, &m.AccessCount, &tagsJSON, &source, &sessionID,
			&m.ContentHash, &m.Embedding, &embModel,
			&m.CreatedAt, &m.UpdatedAt, &expiresAt,
			&m.ImpactScore, &relatedFilesJSON,
			&m.Stability, &lastAccessedAt,
			&encodingCtxJSON,
			&supersededBy,
			&completionStatus,
		); err != nil {
			return nil, fmt.Errorf("scan memory: %w", err)
		}

		populateMemoryNullables(&m, tagsJSON, source, sessionID, embModel, expiresAt,
			relatedFilesJSON, lastAccessedAt, encodingCtxJSON, supersededBy, completionStatus)

		result = append(result, &m)
	}
	return result, rows.Err()
}

// populateMemoryNullables fills in optional fields from nullable SQL columns.
func populateMemoryNullables(
	m *models.Memory,
	tagsJSON, source, sessionID, embModel sql.NullString,
	expiresAt sql.NullInt64,
	relatedFilesJSON sql.NullString,
	lastAccessedAt sql.NullInt64,
	encodingCtxJSON, supersededBy, completionStatus sql.NullString,
) {
	if tagsJSON.Valid {
		json.Unmarshal([]byte(tagsJSON.String), &m.Tags)
	}
	if source.Valid {
		m.Source = source.String
	}
	if sessionID.Valid {
		m.SessionID = sessionID.String
	}
	if embModel.Valid {
		m.EmbeddingModel = embModel.String
	}
	if expiresAt.Valid {
		m.ExpiresAt = &expiresAt.Int64
	}
	if relatedFilesJSON.Valid {
		json.Unmarshal([]byte(relatedFilesJSON.String), &m.RelatedFiles)
	}
	if lastAccessedAt.Valid {
		m.LastAccessedAt = &lastAccessedAt.Int64
	}
	if encodingCtxJSON.Valid {
		var ctx models.EncodingContext
		if json.Unmarshal([]byte(encodingCtxJSON.String), &ctx) == nil {
			m.EncodingContext = &ctx
		}
	}
	if supersededBy.Valid {
		m.SupersededBy = &supersededBy.String
	}
	if completionStatus.Valid {
		m.CompletionStatus = &completionStatus.String
	}
}

// nullableString converts a byte slice to a *string for nullable TEXT columns.
func nullableString(b []byte) *string {
	if b == nil {
		return nil
	}
	s := string(b)
	return &s
}
