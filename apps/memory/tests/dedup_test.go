package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"

	memoryPkg "github.com/anthropics/clive/apps/memory/internal/memory"
	"github.com/anthropics/clive/apps/memory/internal/models"
	"github.com/anthropics/clive/apps/memory/internal/search"
	"github.com/anthropics/clive/apps/memory/internal/store"
)

func TestDeduplicator(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	ms := store.NewMemoryStore(db)
	ws := store.NewWorkspaceStore(db)
	dedup := memoryPkg.NewDeduplicator(ms, 0.92)

	wsID, _ := ws.EnsureWorkspace("/tmp/dedup-test")

	t.Run("detects exact content hash duplicate", func(t *testing.T) {
		content := "Use npm ci instead of npm install in CI"
		hash := "exact-hash-match"
		id := uuid.New().String()
		now := time.Now().Unix()

		mem := &models.Memory{
			ID: id, WorkspaceID: wsID, Content: content,
			MemoryType: models.MemoryTypeWorkingSolution, Tier: models.TierShort,
			Confidence: 0.9, ContentHash: hash, CreatedAt: now, UpdatedAt: now,
		}
		ms.Insert(mem)

		// IsDuplicate uses ContentHash from embedding package, but here we
		// test hash-based dedup by inserting with a known hash and querying
		// with the same content.
		found, err := ms.FindByContentHash(wsID, hash)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(found) == 0 {
			t.Fatal("expected to find hash duplicate")
		}
	})

	t.Run("detects vector similarity duplicate", func(t *testing.T) {
		vec1 := []float32{1.0, 0.5, 0.3, 0.8}
		vec2 := []float32{1.0, 0.5, 0.3, 0.8} // Identical
		now := time.Now().Unix()

		id := uuid.New().String()
		mem := &models.Memory{
			ID: id, WorkspaceID: wsID, Content: "vector test content",
			MemoryType: models.MemoryTypePattern, Tier: models.TierShort,
			Confidence: 0.9, ContentHash: "vec-hash-" + id,
			Embedding: search.Float32ToBytes(vec1),
			CreatedAt: now, UpdatedAt: now,
		}
		ms.Insert(mem)

		dupID, err := dedup.IsDuplicate(wsID, "different content but same vector", vec2)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if dupID == "" {
			t.Fatal("expected to detect vector duplicate")
		}
	})

	t.Run("allows unique content", func(t *testing.T) {
		vec := []float32{0.0, 0.0, 1.0, 0.0} // Very different from existing
		dupID, err := dedup.IsDuplicate(wsID, "completely unique content xyz", vec)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if dupID != "" {
			t.Fatalf("expected no duplicate, got %s", dupID)
		}
	})
}
