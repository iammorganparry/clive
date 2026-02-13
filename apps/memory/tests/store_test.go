package tests

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
)

func setupTestDB(t *testing.T) (*store.DB, func()) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	return db, func() {
		db.Close()
		os.RemoveAll(dir)
	}
}

func TestWorkspaceStore(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	ws := store.NewWorkspaceStore(db)

	t.Run("EnsureWorkspace creates new workspace", func(t *testing.T) {
		id, err := ws.EnsureWorkspace("default","/tmp/test-project")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if id == "" {
			t.Fatal("expected non-empty workspace ID")
		}

		// Same path should return same ID
		id2, err := ws.EnsureWorkspace("default","/tmp/test-project")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if id != id2 {
			t.Fatalf("expected same ID for same path, got %s and %s", id, id2)
		}
	})

	t.Run("GetWorkspace returns workspace", func(t *testing.T) {
		id := store.WorkspaceID("default", "/tmp/test-project")
		w, err := ws.GetWorkspace(id)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if w == nil {
			t.Fatal("expected workspace, got nil")
		}
		if w.Name != "test-project" {
			t.Fatalf("expected name 'test-project', got '%s'", w.Name)
		}
	})

	t.Run("ListWorkspaces returns all", func(t *testing.T) {
		_, _ = ws.EnsureWorkspace("default","/tmp/another-project")
		list, err := ws.ListWorkspaces()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(list) < 2 {
			t.Fatalf("expected at least 2 workspaces, got %d", len(list))
		}
	})
}

func TestMemoryStore(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	ms := store.NewMemoryStore(db)
	ws := store.NewWorkspaceStore(db)

	// Create workspace
	wsID, _ := ws.EnsureWorkspace("default","/tmp/test-project")

	t.Run("Insert and GetByID", func(t *testing.T) {
		id := uuid.New().String()
		now := time.Now().Unix()

		mem := &models.Memory{
			ID:          id,
			WorkspaceID: wsID,
			Content:     "Use Effect.gen for generator-based effects",
			MemoryType:  models.MemoryTypePattern,
			Tier:        models.TierShort,
			Confidence:  0.9,
			Tags:        []string{"effect-ts"},
			Source:      "test",
			ContentHash: "abc123",
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		if err := ms.Insert(mem); err != nil {
			t.Fatalf("insert failed: %v", err)
		}

		got, err := ms.GetByID(id)
		if err != nil {
			t.Fatalf("get failed: %v", err)
		}
		if got == nil {
			t.Fatal("expected memory, got nil")
		}
		if got.Content != mem.Content {
			t.Fatalf("content mismatch: %s != %s", got.Content, mem.Content)
		}
		if got.MemoryType != models.MemoryTypePattern {
			t.Fatalf("type mismatch: %s", got.MemoryType)
		}
	})

	t.Run("Update", func(t *testing.T) {
		id := uuid.New().String()
		now := time.Now().Unix()
		mem := &models.Memory{
			ID: id, WorkspaceID: wsID, Content: "original",
			MemoryType: models.MemoryTypeDecision, Tier: models.TierShort,
			Confidence: 0.7, ContentHash: "def456", CreatedAt: now, UpdatedAt: now,
		}
		ms.Insert(mem)

		newConf := 0.95
		updated, err := ms.Update(id, &models.UpdateRequest{Confidence: &newConf})
		if err != nil {
			t.Fatalf("update failed: %v", err)
		}
		if updated.Confidence != 0.95 {
			t.Fatalf("expected confidence 0.95, got %f", updated.Confidence)
		}
	})

	t.Run("Delete", func(t *testing.T) {
		id := uuid.New().String()
		now := time.Now().Unix()
		mem := &models.Memory{
			ID: id, WorkspaceID: wsID, Content: "to delete",
			MemoryType: models.MemoryTypeContext, Tier: models.TierShort,
			Confidence: 0.5, ContentHash: "ghi789", CreatedAt: now, UpdatedAt: now,
		}
		ms.Insert(mem)

		if err := ms.Delete(id); err != nil {
			t.Fatalf("delete failed: %v", err)
		}

		got, _ := ms.GetByID(id)
		if got != nil {
			t.Fatal("expected nil after delete")
		}
	})

	t.Run("FindByContentHash", func(t *testing.T) {
		id := uuid.New().String()
		now := time.Now().Unix()
		hash := "unique-hash-123"
		mem := &models.Memory{
			ID: id, WorkspaceID: wsID, Content: "hash test",
			MemoryType: models.MemoryTypeGotcha, Tier: models.TierShort,
			Confidence: 0.8, ContentHash: hash, CreatedAt: now, UpdatedAt: now,
		}
		ms.Insert(mem)

		found, err := ms.FindByContentHash(wsID, hash)
		if err != nil {
			t.Fatalf("find by hash failed: %v", err)
		}
		if len(found) != 1 {
			t.Fatalf("expected 1 result, got %d", len(found))
		}
		if found[0].ID != id {
			t.Fatalf("ID mismatch")
		}
	})

	t.Run("DeleteExpired", func(t *testing.T) {
		id := uuid.New().String()
		past := time.Now().Add(-1 * time.Hour).Unix()
		now := time.Now().Unix()
		mem := &models.Memory{
			ID: id, WorkspaceID: wsID, Content: "expired memory",
			MemoryType: models.MemoryTypeContext, Tier: models.TierShort,
			Confidence: 0.5, ContentHash: "expired-hash",
			CreatedAt: now, UpdatedAt: now, ExpiresAt: &past,
		}
		ms.Insert(mem)

		n, err := ms.DeleteExpired()
		if err != nil {
			t.Fatalf("delete expired failed: %v", err)
		}
		if n < 1 {
			t.Fatalf("expected at least 1 expired deletion, got %d", n)
		}

		got, _ := ms.GetByID(id)
		if got != nil {
			t.Fatal("expected expired memory to be deleted")
		}
	})

	t.Run("CountByWorkspace", func(t *testing.T) {
		total, shortTerm, longTerm, byType, err := ms.CountByWorkspace(wsID)
		if err != nil {
			t.Fatalf("count failed: %v", err)
		}
		if total < 1 {
			t.Fatal("expected at least 1 memory")
		}
		// All should be short-term
		if shortTerm < 1 {
			t.Fatal("expected at least 1 short-term")
		}
		_ = longTerm
		_ = byType
	})
}

func TestEmbeddingCacheStore(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	cs := store.NewEmbeddingCacheStore(db)

	t.Run("Put and Get", func(t *testing.T) {
		entry := &models.EmbeddingCacheEntry{
			ContentHash: "test-hash",
			Embedding:   []byte{1, 2, 3, 4},
			Dimension:   768,
			Model:       "nomic-embed-text",
		}

		if err := cs.Put(entry); err != nil {
			t.Fatalf("put failed: %v", err)
		}

		got, err := cs.Get("test-hash")
		if err != nil {
			t.Fatalf("get failed: %v", err)
		}
		if got == nil {
			t.Fatal("expected entry, got nil")
		}
		if got.Model != "nomic-embed-text" {
			t.Fatalf("model mismatch: %s", got.Model)
		}
	})

	t.Run("Get miss returns nil", func(t *testing.T) {
		got, err := cs.Get("nonexistent")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != nil {
			t.Fatal("expected nil for cache miss")
		}
	})
}
