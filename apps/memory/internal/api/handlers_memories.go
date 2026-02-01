package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/anthropics/clive/apps/memory/internal/memory"
	"github.com/anthropics/clive/apps/memory/internal/models"
)

type MemoryHandler struct {
	svc *memory.Service
}

func NewMemoryHandler(svc *memory.Service) *MemoryHandler {
	return &MemoryHandler{svc: svc}
}

// List handles GET /memories
func (h *MemoryHandler) List(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	sort := r.URL.Query().Get("sort")
	order := r.URL.Query().Get("order")
	workspaceID := r.URL.Query().Get("workspace_id")
	tier := r.URL.Query().Get("tier")
	source := r.URL.Query().Get("source")

	var memoryTypes []models.MemoryType
	if mt := r.URL.Query().Get("memory_type"); mt != "" {
		for _, t := range strings.Split(mt, ",") {
			memoryTypes = append(memoryTypes, models.MemoryType(t))
		}
	}

	req := &models.ListRequest{
		Page:        page,
		Limit:       limit,
		Sort:        sort,
		Order:       order,
		WorkspaceID: workspaceID,
		MemoryTypes: memoryTypes,
		Tier:        tier,
		Source:      source,
	}

	resp, err := h.svc.List(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// Store handles POST /memories
func (h *MemoryHandler) Store(w http.ResponseWriter, r *http.Request) {
	var req models.StoreRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if !req.MemoryType.IsValid() {
		writeError(w, http.StatusBadRequest, "invalid memoryType")
		return
	}

	resp, err := h.svc.Store(&req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	status := http.StatusCreated
	if resp.Deduplicated {
		status = http.StatusOK
	}
	writeJSON(w, status, resp)
}

// Search handles POST /memories/search
func (h *MemoryHandler) Search(w http.ResponseWriter, r *http.Request) {
	var req models.SearchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}

	resp, err := h.svc.Search(&req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// Get handles GET /memories/{id}
func (h *MemoryHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	mem, err := h.svc.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if mem == nil {
		writeError(w, http.StatusNotFound, "memory not found")
		return
	}

	writeJSON(w, http.StatusOK, mem)
}

// Update handles PATCH /memories/{id}
func (h *MemoryHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.UpdateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	mem, err := h.svc.Update(id, &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, mem)
}

// Delete handles DELETE /memories/{id}
func (h *MemoryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.svc.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// RecordImpact handles POST /memories/{id}/impact
func (h *MemoryHandler) RecordImpact(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.RecordImpactRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if !req.Signal.IsValid() {
		writeError(w, http.StatusBadRequest, "invalid signal: must be helpful, promoted, or cited")
		return
	}
	if req.Source == "" {
		writeError(w, http.StatusBadRequest, "source is required")
		return
	}

	resp, err := h.svc.RecordImpact(id, &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// ImpactEvents handles GET /memories/{id}/impact
func (h *MemoryHandler) ImpactEvents(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	events, err := h.svc.GetImpactEvents(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if events == nil {
		events = []models.ImpactEvent{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"events": events,
	})
}

// ImpactLeaders handles GET /memories/impact-leaders
func (h *MemoryHandler) ImpactLeaders(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	memories, err := h.svc.GetImpactLeaders(workspaceID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if memories == nil {
		memories = []*models.Memory{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"memories": memories,
	})
}

// SearchIndex handles POST /memories/search/index (Layer 1 progressive disclosure)
func (h *MemoryHandler) SearchIndex(w http.ResponseWriter, r *http.Request) {
	var req models.SearchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}

	resp, err := h.svc.SearchIndex(&req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// Timeline handles POST /memories/timeline (Layer 2 progressive disclosure)
func (h *MemoryHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	var req models.TimelineRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.MemoryID == "" {
		writeError(w, http.StatusBadRequest, "memoryId is required")
		return
	}

	resp, err := h.svc.Timeline(&req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// BatchGet handles POST /memories/batch-get (Layer 3 progressive disclosure)
func (h *MemoryHandler) BatchGet(w http.ResponseWriter, r *http.Request) {
	var req models.BatchGetRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids array is required")
		return
	}

	resp, err := h.svc.BatchGet(&req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// Supersede handles POST /memories/{id}/supersede
func (h *MemoryHandler) Supersede(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.SupersedeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.NewMemoryID == "" {
		writeError(w, http.StatusBadRequest, "newMemoryId is required")
		return
	}

	resp, err := h.svc.Supersede(id, req.NewMemoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}
