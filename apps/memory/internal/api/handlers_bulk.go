package api

import (
	"net/http"

	"github.com/anthropics/clive/apps/memory/internal/memory"
	"github.com/anthropics/clive/apps/memory/internal/models"
)

type BulkHandler struct {
	svc *memory.Service
}

func NewBulkHandler(svc *memory.Service) *BulkHandler {
	return &BulkHandler{svc: svc}
}

// BulkStore handles POST /memories/bulk
func (h *BulkHandler) BulkStore(w http.ResponseWriter, r *http.Request) {
	var req models.BulkStoreRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	req.Namespace = GetNamespace(r)

	if len(req.Memories) == 0 {
		writeError(w, http.StatusBadRequest, "memories array is required")
		return
	}

	resp, err := h.svc.BulkStore(&req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// Compact handles POST /memories/compact
func (h *BulkHandler) Compact(w http.ResponseWriter, r *http.Request) {
	resp, err := h.svc.Compact()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}
