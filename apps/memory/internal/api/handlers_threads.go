package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/threads"
)

type ThreadHandler struct {
	svc *threads.Service
}

func NewThreadHandler(svc *threads.Service) *ThreadHandler {
	return &ThreadHandler{svc: svc}
}

// Create handles POST /threads
func (h *ThreadHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req models.CreateThreadRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	req.Namespace = GetNamespace(r)

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace is required")
		return
	}

	thread, err := h.svc.Create(&req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, thread)
}

// List handles GET /threads
func (h *ThreadHandler) List(w http.ResponseWriter, r *http.Request) {
	req := &models.ListThreadsRequest{
		Namespace: GetNamespace(r),
		Workspace: r.URL.Query().Get("workspace"),
		Status:    models.ThreadStatus(r.URL.Query().Get("status")),
		Name:      r.URL.Query().Get("name"),
	}

	threads, err := h.svc.List(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if threads == nil {
		threads = []*models.FeatureThread{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"threads": threads,
	})
}

// Get handles GET /threads/{id}
func (h *ThreadHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	result, err := h.svc.Get(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if result == nil {
		writeError(w, http.StatusNotFound, "thread not found")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// Update handles PATCH /threads/{id}
func (h *ThreadHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.UpdateThreadRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Status != nil && !req.Status.IsValid() {
		writeError(w, http.StatusBadRequest, "invalid status: must be active, paused, or closed")
		return
	}

	thread, err := h.svc.Update(id, &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, thread)
}

// Delete handles DELETE /threads/{id}
func (h *ThreadHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.svc.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// AppendEntry handles POST /threads/{id}/entries
func (h *ThreadHandler) AppendEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.AppendEntryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	req.Namespace = GetNamespace(r)

	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	if req.Section != "" && !req.Section.IsValid() {
		writeError(w, http.StatusBadRequest, "invalid section: must be findings, decisions, architecture, todo, or context")
		return
	}

	if req.MemoryType != "" && !req.MemoryType.IsValid() {
		writeError(w, http.StatusBadRequest, "invalid memoryType")
		return
	}

	entry, err := h.svc.AppendEntry(id, &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, entry)
}

// Close handles POST /threads/{id}/close
func (h *ThreadHandler) Close(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.CloseThreadRequest
	if err := decodeJSON(r, &req); err != nil {
		// Allow empty body (defaults distill=false)
		req = models.CloseThreadRequest{}
	}

	resp, err := h.svc.Close(id, req.Distill)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// GetContext handles GET /threads/{id}/context
func (h *ThreadHandler) GetContext(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	context, err := h.svc.GetContext(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, &models.ThreadContextResponse{
		Context: context,
	})
}

// GetActiveContext handles GET /threads/active/context
func (h *ThreadHandler) GetActiveContext(w http.ResponseWriter, r *http.Request) {
	namespace := GetNamespace(r)
	workspace := r.URL.Query().Get("workspace")
	branch := r.URL.Query().Get("branch")

	context, err := h.svc.GetActiveContext(namespace, workspace, branch)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, &models.ThreadContextResponse{
		Context: context,
	})
}
