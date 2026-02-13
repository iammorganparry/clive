package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/iammorganparry/clive/apps/memory/internal/memory"
)

type WorkspaceHandler struct {
	svc *memory.Service
}

func NewWorkspaceHandler(svc *memory.Service) *WorkspaceHandler {
	return &WorkspaceHandler{svc: svc}
}

// List handles GET /workspaces
func (h *WorkspaceHandler) List(w http.ResponseWriter, r *http.Request) {
	workspaces, err := h.svc.ListWorkspaces()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, workspaces)
}

// Stats handles GET /workspaces/{id}/stats
func (h *WorkspaceHandler) Stats(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	stats, err := h.svc.GetWorkspaceStats(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, stats)
}
