package tests

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"log/slog"

	"github.com/anthropics/clive/apps/memory/internal/api"
	"github.com/anthropics/clive/apps/memory/internal/embedding"
	"github.com/anthropics/clive/apps/memory/internal/memory"
	"github.com/anthropics/clive/apps/memory/internal/models"
	"github.com/anthropics/clive/apps/memory/internal/search"
	"github.com/anthropics/clive/apps/memory/internal/sessions"
	"github.com/anthropics/clive/apps/memory/internal/store"
	"github.com/anthropics/clive/apps/memory/internal/vectorstore"
)

// fakeOllamaServer returns a test HTTP server that mimics the Ollama embedding API.
func fakeOllamaServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/embed":
			// Return a deterministic fake embedding derived from content hash
			vec := make([]float32, 768)
			var req struct {
				Input string `json:"input"`
			}
			json.NewDecoder(r.Body).Decode(&req)
			// Use full SHA-256 hash of input to produce distinct vectors
			h := sha256.Sum256([]byte(req.Input))
			for i := range vec {
				vec[i] = float32(h[i%32]) / 255.0
			}
			resp := map[string]any{"embeddings": [][]float32{vec}}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		case "/api/tags":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"models": []any{}})
		default:
			http.NotFound(w, r)
		}
	}))
}

// fakeQdrantServer returns a test server that mimics basic Qdrant REST API.
func fakeQdrantServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/healthz":
			w.WriteHeader(http.StatusOK)
		case r.Method == "GET":
			// Collection exists check
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
		case r.Method == "PUT":
			// Upsert or create collection
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
		case r.Method == "POST":
			// Search or delete
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"result": []any{}})
		default:
			http.NotFound(w, r)
		}
	}))
}

func setupIntegrationTest(t *testing.T) (*httptest.Server, func()) {
	t.Helper()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	// Fake external services
	ollamaSrv := fakeOllamaServer()
	qdrantSrv := fakeQdrantServer()

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	// Build all components
	memoryStore := store.NewMemoryStore(db)
	workspaceStore := store.NewWorkspaceStore(db)
	bm25Store := store.NewBM25Store(db)
	embCacheStore := store.NewEmbeddingCacheStore(db)

	ollamaClient := embedding.NewOllamaClient(ollamaSrv.URL, "nomic-embed-text")
	qdrantClient := vectorstore.NewQdrantClient(qdrantSrv.URL, 768)
	collMgr := vectorstore.NewCollectionManager(qdrantClient)

	embedder := embedding.NewCachedEmbedder(ollamaClient, embCacheStore, "nomic-embed-text", 768)

	linkStore := store.NewLinkStore(db)
	searcher := search.NewHybridSearcher(
		memoryStore, bm25Store, linkStore, qdrantClient, collMgr,
		0.7, 0.3, 1.2,
	)

	dedup := memory.NewDeduplicator(memoryStore, 0.92)
	lifecycle := memory.NewLifecycleManager(memoryStore, qdrantClient, collMgr, 3, 0.85, logger)
	svc := memory.NewService(
		memoryStore, workspaceStore, bm25Store, embedder,
		qdrantClient, collMgr, searcher, dedup, lifecycle,
		72, logger,
	)

	sessStore := sessions.NewSessionStore(db)
	obsStore := sessions.NewObservationStore(db)
	summarizer := sessions.NewSummarizer(ollamaSrv.URL, "test-model", false, logger)

	router := api.NewRouter(db, svc, ollamaClient, qdrantClient, nil, sessStore, obsStore, summarizer, "", logger)
	srv := httptest.NewServer(router)

	cleanup := func() {
		srv.Close()
		ollamaSrv.Close()
		qdrantSrv.Close()
		db.Close()
		os.RemoveAll(dir)
	}

	return srv, cleanup
}

func TestHealthEndpoint(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	resp, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var health models.HealthResponse
	json.NewDecoder(resp.Body).Decode(&health)

	if health.Ollama.Status != "ok" {
		t.Fatalf("expected ollama ok, got %s", health.Ollama.Status)
	}
}

func TestStoreAndSearch(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	// Store a memory
	storeReq := models.StoreRequest{
		Workspace:  "/tmp/test-project",
		Content:    "Always use Effect.gen for generator-based effects in this codebase",
		MemoryType: models.MemoryTypePattern,
		Tier:       models.TierShort,
		Confidence: 0.9,
		Tags:       []string{"effect-ts", "patterns"},
		Source:     "test",
	}
	body, _ := json.Marshal(storeReq)

	resp, err := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("store request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var storeResp models.StoreResponse
	json.NewDecoder(resp.Body).Decode(&storeResp)

	if storeResp.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if storeResp.Deduplicated {
		t.Fatal("expected not deduplicated")
	}

	// Get memory by ID
	getResp, err := http.Get(srv.URL + "/memories/" + storeResp.ID)
	if err != nil {
		t.Fatalf("get request failed: %v", err)
	}
	defer getResp.Body.Close()

	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", getResp.StatusCode)
	}

	// Search for the memory
	searchReq := models.SearchRequest{
		Workspace:     "/tmp/test-project",
		Query:         "Effect generator patterns",
		MaxResults:    5,
		MinScore:      0.1,
		IncludeGlobal: true,
		SearchMode:    models.SearchModeHybrid,
	}
	body, _ = json.Marshal(searchReq)

	searchResp, err := http.Post(srv.URL+"/memories/search", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("search request failed: %v", err)
	}
	defer searchResp.Body.Close()

	if searchResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", searchResp.StatusCode)
	}

	var searchResult models.SearchResponse
	json.NewDecoder(searchResp.Body).Decode(&searchResult)

	if len(searchResult.Results) == 0 {
		t.Fatal("expected at least 1 search result")
	}
}

func TestDeduplication(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	storeReq := models.StoreRequest{
		Workspace:  "/tmp/test-project",
		Content:    "Deduplicate me please",
		MemoryType: models.MemoryTypeDecision,
		Tier:       models.TierShort,
		Confidence: 0.9,
	}
	body, _ := json.Marshal(storeReq)

	// First store
	resp1, _ := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))
	resp1.Body.Close()
	if resp1.StatusCode != http.StatusCreated {
		t.Fatalf("first store: expected 201, got %d", resp1.StatusCode)
	}

	// Second store (should be deduplicated)
	body, _ = json.Marshal(storeReq)
	resp2, _ := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))

	var result models.StoreResponse
	json.NewDecoder(resp2.Body).Decode(&result)
	resp2.Body.Close()

	if !result.Deduplicated {
		t.Fatal("expected second store to be deduplicated")
	}
}

func TestBulkStore(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	bulkReq := models.BulkStoreRequest{
		Workspace: "/tmp/test-project",
		SessionID: "test-session",
		Memories: []models.BulkMemory{
			{Content: "Learning 1: use chi router", MemoryType: models.MemoryTypeWorkingSolution, Confidence: 0.9},
			{Content: "Learning 2: SQLite WAL mode", MemoryType: models.MemoryTypePattern, Confidence: 0.85},
			{Content: "Learning 3: avoid global state", MemoryType: models.MemoryTypeDecision, Confidence: 0.8},
		},
	}
	body, _ := json.Marshal(bulkReq)

	resp, err := http.Post(srv.URL+"/memories/bulk", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("bulk store failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result models.BulkStoreResponse
	json.NewDecoder(resp.Body).Decode(&result)

	if result.Stored != 3 {
		t.Fatalf("expected 3 stored, got %d", result.Stored)
	}
}

func TestCompact(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	resp, err := http.Post(srv.URL+"/memories/compact", "application/json", nil)
	if err != nil {
		t.Fatalf("compact failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result models.CompactResponse
	json.NewDecoder(resp.Body).Decode(&result)
	// Should succeed even with nothing to compact
}

func TestDeleteMemory(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	// Store
	storeReq := models.StoreRequest{
		Workspace:  "/tmp/test-project",
		Content:    "Memory to delete",
		MemoryType: models.MemoryTypeContext,
		Tier:       models.TierShort,
		Confidence: 0.5,
	}
	body, _ := json.Marshal(storeReq)
	resp, _ := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))

	var storeResp models.StoreResponse
	json.NewDecoder(resp.Body).Decode(&storeResp)
	resp.Body.Close()

	// Delete
	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/memories/"+storeResp.ID, nil)
	delResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	delResp.Body.Close()

	if delResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", delResp.StatusCode)
	}

	// Verify gone
	getResp, _ := http.Get(srv.URL + "/memories/" + storeResp.ID)
	getResp.Body.Close()
	if getResp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", getResp.StatusCode)
	}
}

func TestWorkspaces(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	// Store a memory to create workspace
	storeReq := models.StoreRequest{
		Workspace:  "/tmp/ws-test-project",
		Content:    "workspace test memory",
		MemoryType: models.MemoryTypeContext,
		Tier:       models.TierShort,
		Confidence: 0.5,
	}
	body, _ := json.Marshal(storeReq)
	resp, _ := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))
	resp.Body.Close()

	// List workspaces
	listResp, err := http.Get(srv.URL + "/workspaces")
	if err != nil {
		t.Fatalf("list workspaces failed: %v", err)
	}
	defer listResp.Body.Close()

	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.StatusCode)
	}

	var workspaces []models.Workspace
	json.NewDecoder(listResp.Body).Decode(&workspaces)

	if len(workspaces) == 0 {
		t.Fatal("expected at least 1 workspace")
	}

	// Get workspace stats
	wsID := workspaces[0].ID
	statsResp, err := http.Get(srv.URL + "/workspaces/" + wsID + "/stats")
	if err != nil {
		t.Fatalf("get stats failed: %v", err)
	}
	defer statsResp.Body.Close()

	if statsResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", statsResp.StatusCode)
	}
}

func TestUpdateMemory(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	// Store
	storeReq := models.StoreRequest{
		Workspace:  "/tmp/test-project",
		Content:    "Memory to update",
		MemoryType: models.MemoryTypeDecision,
		Tier:       models.TierShort,
		Confidence: 0.5,
	}
	body, _ := json.Marshal(storeReq)
	resp, _ := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))

	var storeResp models.StoreResponse
	json.NewDecoder(resp.Body).Decode(&storeResp)
	resp.Body.Close()

	// Update confidence
	newConf := 0.95
	updateReq := models.UpdateRequest{Confidence: &newConf}
	body, _ = json.Marshal(updateReq)
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/memories/"+storeResp.ID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	patchResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}
	defer patchResp.Body.Close()

	if patchResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", patchResp.StatusCode)
	}

	var updated models.Memory
	json.NewDecoder(patchResp.Body).Decode(&updated)

	if updated.Confidence != 0.95 {
		t.Fatalf("expected confidence 0.95, got %f", updated.Confidence)
	}
}

func TestValidation(t *testing.T) {
	srv, cleanup := setupIntegrationTest(t)
	defer cleanup()

	t.Run("empty content", func(t *testing.T) {
		storeReq := models.StoreRequest{
			Workspace:  "/tmp/test",
			Content:    "",
			MemoryType: models.MemoryTypeContext,
		}
		body, _ := json.Marshal(storeReq)
		resp, _ := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for empty content, got %d", resp.StatusCode)
		}
	})

	t.Run("invalid memory type", func(t *testing.T) {
		storeReq := map[string]any{
			"workspace":  "/tmp/test",
			"content":    "test",
			"memoryType": "INVALID_TYPE",
		}
		body, _ := json.Marshal(storeReq)
		resp, _ := http.Post(srv.URL+"/memories", "application/json", bytes.NewReader(body))
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid type, got %d", resp.StatusCode)
		}
	})

	t.Run("empty search query", func(t *testing.T) {
		searchReq := models.SearchRequest{Query: ""}
		body, _ := json.Marshal(searchReq)
		resp, _ := http.Post(srv.URL+"/memories/search", "application/json", bytes.NewReader(body))
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for empty query, got %d", resp.StatusCode)
		}
	})
}
