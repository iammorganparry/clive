package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/iammorganparry/clive/apps/memory/internal/api"
	"github.com/iammorganparry/clive/apps/memory/internal/config"
	"github.com/iammorganparry/clive/apps/memory/internal/embedding"
	"github.com/iammorganparry/clive/apps/memory/internal/memory"
	"github.com/iammorganparry/clive/apps/memory/internal/search"
	"github.com/iammorganparry/clive/apps/memory/internal/sessions"
	"github.com/iammorganparry/clive/apps/memory/internal/skills"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
	"github.com/iammorganparry/clive/apps/memory/internal/threads"
	"github.com/iammorganparry/clive/apps/memory/internal/vectorstore"
)

func main() {
	// Logger
	logLevel := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		logLevel = slog.LevelDebug
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	// Config
	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// SQLite
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		logger.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Stores
	memoryStore := store.NewMemoryStore(db)
	workspaceStore := store.NewWorkspaceStore(db)
	bm25Store := store.NewBM25Store(db)
	embCacheStore := store.NewEmbeddingCacheStore(db)
	linkStore := store.NewLinkStore(db)

	// External services
	ollamaClient := embedding.NewOllamaClient(cfg.OllamaBaseURL, cfg.EmbeddingModel)
	qdrantClient := vectorstore.NewQdrantClient(cfg.QdrantURL, cfg.EmbeddingDim)
	collMgr := vectorstore.NewCollectionManager(qdrantClient)

	// Embedding with cache
	embedder := embedding.NewCachedEmbedder(ollamaClient, embCacheStore, cfg.EmbeddingModel, cfg.EmbeddingDim)

	// Search
	searcher := search.NewHybridSearcher(
		memoryStore, bm25Store, linkStore, qdrantClient, collMgr,
		cfg.VectorWeight, cfg.BM25Weight, cfg.LongTermBoost,
	)

	// Memory service
	dedup := memory.NewDeduplicator(memoryStore, cfg.DedupThreshold)
	lifecycle := memory.NewLifecycleManager(
		memoryStore, qdrantClient, collMgr,
		cfg.PromotionAccessMin, cfg.PromotionConfidence, logger,
	)
	svc := memory.NewService(
		memoryStore, workspaceStore, bm25Store, embedder,
		qdrantClient, collMgr, searcher, dedup, lifecycle,
		cfg.ShortTermTTLHours, logger,
	)

	// Ensure global workspace collection exists in Qdrant
	if err := qdrantClient.HealthCheck(); err != nil {
		logger.Warn("qdrant not available at startup, will retry on first use", "error", err)
	} else {
		if _, err := collMgr.EnsureForWorkspace("__global__"); err != nil {
			logger.Warn("failed to create global collection", "error", err)
		}
	}

	// Sessions
	sessStore := sessions.NewSessionStore(db)
	obsStore := sessions.NewObservationStore(db)
	summarizer := sessions.NewSummarizer(cfg.OllamaBaseURL, cfg.SummaryModel, cfg.SummaryEnabled, logger)

	// Skill sync
	var skillSync *skills.SyncService
	if len(cfg.SkillDirs) > 0 {
		skillSync = skills.NewSyncService(svc, memoryStore, qdrantClient, cfg.SkillDirs, logger)
	}

	// Feature threads
	threadStore := store.NewThreadStore(db)
	threadSvc := threads.NewService(threadStore, memoryStore, workspaceStore, logger)

	// Router
	router := api.NewRouter(db, svc, ollamaClient, qdrantClient, skillSync, sessStore, obsStore, summarizer, threadSvc, cfg.APIKey, logger)

	// Server
	addr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		logger.Info("memory server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Auto-sync skills on startup
	if cfg.SkillAutoSync && skillSync != nil {
		go func() {
			result, err := skillSync.Sync()
			if err != nil {
				logger.Error("skill auto-sync failed", "error", err)
				return
			}
			logger.Info("skill auto-sync complete",
				"found", result.Found,
				"stored", result.Stored,
				"errors", result.Errors,
			)
		}()
	}

	<-done
	logger.Info("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("shutdown error", "error", err)
	}

	logger.Info("server stopped")
}
