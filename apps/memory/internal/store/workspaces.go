package store

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"path/filepath"
	"time"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
)

// WorkspaceStore handles workspace registration and lookup.
type WorkspaceStore struct {
	db *DB
}

func NewWorkspaceStore(db *DB) *WorkspaceStore {
	ws := &WorkspaceStore{db: db}
	// Ensure the global workspace always exists
	ws.ensureGlobal()
	return ws
}

func (s *WorkspaceStore) ensureGlobal() {
	now := time.Now().Unix()
	s.db.Exec(`
		INSERT INTO workspaces (id, path, name, created_at, last_accessed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING
	`, models.GlobalWorkspaceID, "__global__", "global", now, now)
}

// WorkspaceID computes the deterministic ID for a namespace + workspace path.
// For backward compatibility, "default" namespace produces the same hash as before.
func WorkspaceID(namespace, absPath string) string {
	var input string
	if namespace == "" || namespace == "default" {
		input = absPath // backward compatible
	} else {
		input = namespace + ":" + absPath
	}
	h := sha256.Sum256([]byte(input))
	return fmt.Sprintf("%x", h[:16]) // 32-char hex
}

// NamespacedGlobalID returns the global workspace ID for a namespace.
func NamespacedGlobalID(namespace string) string {
	if namespace == "" || namespace == "default" {
		return models.GlobalWorkspaceID // "__global__"
	}
	return "__global__:" + namespace
}

// EnsureWorkspace registers a workspace if it doesn't exist, or updates
// last_accessed_at if it does. Returns the workspace ID.
func (s *WorkspaceStore) EnsureWorkspace(namespace, absPath string) (string, error) {
	id := WorkspaceID(namespace, absPath)
	name := filepath.Base(absPath)
	now := time.Now().Unix()

	// For non-default namespaces, prefix the stored path to avoid UNIQUE constraint
	// conflicts when two namespaces use the same workspace path.
	storedPath := absPath
	if namespace != "" && namespace != "default" {
		storedPath = namespace + ":" + absPath
	}

	_, err := s.db.Exec(`
		INSERT INTO workspaces (id, path, name, created_at, last_accessed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET last_accessed_at = ?
	`, id, storedPath, name, now, now, now)
	if err != nil {
		return "", fmt.Errorf("ensure workspace: %w", err)
	}

	return id, nil
}

// EnsureNamespacedGlobal ensures the global workspace exists for a namespace.
func (s *WorkspaceStore) EnsureNamespacedGlobal(namespace string) {
	globalID := NamespacedGlobalID(namespace)
	globalPath := "__global__"
	if namespace != "" && namespace != "default" {
		globalPath = "__global__:" + namespace
	}
	now := time.Now().Unix()
	s.db.Exec(`
		INSERT INTO workspaces (id, path, name, created_at, last_accessed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING
	`, globalID, globalPath, "global", now, now)
}

// GetWorkspace returns a workspace by ID.
func (s *WorkspaceStore) GetWorkspace(id string) (*models.Workspace, error) {
	var w models.Workspace
	err := s.db.QueryRow(`
		SELECT id, path, name, created_at, last_accessed_at
		FROM workspaces WHERE id = ?
	`, id).Scan(&w.ID, &w.Path, &w.Name, &w.CreatedAt, &w.LastAccessedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get workspace: %w", err)
	}
	return &w, nil
}

// ListWorkspaces returns all registered workspaces.
func (s *WorkspaceStore) ListWorkspaces() ([]models.Workspace, error) {
	rows, err := s.db.Query(`
		SELECT id, path, name, created_at, last_accessed_at
		FROM workspaces ORDER BY last_accessed_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	defer rows.Close()

	var workspaces []models.Workspace
	for rows.Next() {
		var w models.Workspace
		if err := rows.Scan(&w.ID, &w.Path, &w.Name, &w.CreatedAt, &w.LastAccessedAt); err != nil {
			return nil, fmt.Errorf("scan workspace: %w", err)
		}
		workspaces = append(workspaces, w)
	}
	return workspaces, rows.Err()
}
