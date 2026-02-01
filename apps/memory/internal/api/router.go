package api

import (
	"log/slog"

	"github.com/go-chi/chi/v5"

	"github.com/anthropics/clive/apps/memory/internal/embedding"
	"github.com/anthropics/clive/apps/memory/internal/memory"
	"github.com/anthropics/clive/apps/memory/internal/sessions"
	"github.com/anthropics/clive/apps/memory/internal/skills"
	"github.com/anthropics/clive/apps/memory/internal/store"
	"github.com/anthropics/clive/apps/memory/internal/vectorstore"
)

// NewRouter creates the Chi router with all routes and middleware.
func NewRouter(
	db *store.DB,
	svc *memory.Service,
	ollama *embedding.OllamaClient,
	qdrant *vectorstore.QdrantClient,
	skillSync *skills.SyncService,
	sessStore *sessions.SessionStore,
	obsStore *sessions.ObservationStore,
	summarizer *sessions.Summarizer,
	apiKey string,
	logger *slog.Logger,
) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware (runs on ALL routes including /health)
	r.Use(CORS)
	r.Use(RequestID)
	r.Use(Logger(logger))
	r.Use(Recovery(logger))

	// Handlers
	healthH := NewHealthHandler(db, ollama, qdrant)
	memoryH := NewMemoryHandler(svc)
	bulkH := NewBulkHandler(svc)
	workspaceH := NewWorkspaceHandler(svc)

	// Unauthenticated routes
	r.Get("/health", healthH.Health)

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(BearerAuth(apiKey))

		r.Route("/memories", func(r chi.Router) {
			r.Get("/", memoryH.List)
			r.Post("/", memoryH.Store)
			r.Post("/search", memoryH.Search)
			r.Post("/search/index", memoryH.SearchIndex)
			r.Post("/timeline", memoryH.Timeline)
			r.Post("/batch", memoryH.BatchGet)
			r.Post("/bulk", bulkH.BulkStore)
			r.Post("/compact", bulkH.Compact)
			r.Get("/impact-leaders", memoryH.ImpactLeaders)
			r.Get("/{id}", memoryH.Get)
			r.Patch("/{id}", memoryH.Update)
			r.Delete("/{id}", memoryH.Delete)
			r.Post("/{id}/impact", memoryH.RecordImpact)
			r.Get("/{id}/impact", memoryH.ImpactEvents)
			r.Post("/{id}/supersede", memoryH.Supersede)
		})

		r.Route("/workspaces", func(r chi.Router) {
			r.Get("/", workspaceH.List)
			r.Get("/{id}/stats", workspaceH.Stats)
		})

		// Session routes
		if sessStore != nil {
			sessionH := NewSessionHandler(svc, sessStore, obsStore, summarizer)
			r.Route("/sessions", func(r chi.Router) {
				r.Get("/", sessionH.ListSessions)
				r.Post("/summarize", sessionH.Summarize)
				r.Get("/{id}", sessionH.GetSession)
				r.Post("/{id}/observations", sessionH.StoreObservation)
				r.Get("/{id}/observations", sessionH.ListObservations)
			})
		}

		if skillSync != nil {
			skillH := NewSkillHandler(skillSync)
			r.Route("/skills", func(r chi.Router) {
				r.Post("/sync", skillH.Sync)
				r.Get("/", skillH.List)
			})
		}
	})

	return r
}
