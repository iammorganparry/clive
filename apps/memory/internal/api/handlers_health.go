package api

import (
	"net/http"

	"github.com/iammorganparry/clive/apps/memory/internal/embedding"
	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
	"github.com/iammorganparry/clive/apps/memory/internal/vectorstore"
)

type HealthHandler struct {
	db     *store.DB
	ollama *embedding.OllamaClient
	qdrant *vectorstore.QdrantClient
}

func NewHealthHandler(db *store.DB, ollama *embedding.OllamaClient, qdrant *vectorstore.QdrantClient) *HealthHandler {
	return &HealthHandler{db: db, ollama: ollama, qdrant: qdrant}
}

func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	resp := models.HealthResponse{
		Status: "ok",
	}

	// Check Ollama
	if err := h.ollama.HealthCheck(); err != nil {
		resp.Ollama = models.ServiceCheck{Status: "error", Message: err.Error()}
		resp.Status = "degraded"
	} else {
		resp.Ollama = models.ServiceCheck{Status: "ok"}
	}

	// Check Qdrant
	if err := h.qdrant.HealthCheck(); err != nil {
		resp.Qdrant = models.ServiceCheck{Status: "error", Message: err.Error()}
		resp.Status = "degraded"
	} else {
		resp.Qdrant = models.ServiceCheck{Status: "ok"}
	}

	// Check DB
	count, err := h.db.MemoryCount()
	if err != nil {
		resp.DB = models.ServiceCheck{Status: "error", Message: err.Error()}
		resp.Status = "degraded"
	} else {
		resp.DB = models.ServiceCheck{Status: "ok"}
		resp.MemoryCount = count
	}

	status := http.StatusOK
	if resp.Status != "ok" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, resp)
}
