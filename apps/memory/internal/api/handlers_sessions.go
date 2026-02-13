package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/iammorganparry/clive/apps/memory/internal/memory"
	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/sessions"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
)

// SessionHandler handles session-related HTTP requests.
type SessionHandler struct {
	svc        *memory.Service
	sessStore  *sessions.SessionStore
	obsStore   *sessions.ObservationStore
	summarizer *sessions.Summarizer
}

// NewSessionHandler creates a new session handler.
func NewSessionHandler(
	svc *memory.Service,
	sessStore *sessions.SessionStore,
	obsStore *sessions.ObservationStore,
	summarizer *sessions.Summarizer,
) *SessionHandler {
	return &SessionHandler{
		svc:        svc,
		sessStore:  sessStore,
		obsStore:   obsStore,
		summarizer: summarizer,
	}
}

// Summarize handles POST /sessions/summarize
func (h *SessionHandler) Summarize(w http.ResponseWriter, r *http.Request) {
	var req models.SummarizeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	req.Namespace = GetNamespace(r)

	if req.SessionID == "" {
		writeError(w, http.StatusBadRequest, "sessionId is required")
		return
	}
	if req.Transcript == "" {
		writeError(w, http.StatusBadRequest, "transcript is required")
		return
	}

	// Ensure session exists
	workspaceID := store.NamespacedGlobalID(req.Namespace)
	if req.Workspace != "" {
		// Use service to resolve workspace
		// For simplicity, resolve through session store
	}

	sess, err := h.sessStore.EnsureSession(req.SessionID, workspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ensure session: "+err.Error())
		return
	}

	// End the session
	_ = h.sessStore.EndSession(sess.ID)

	// Generate summary
	var summary string
	if h.summarizer != nil && h.summarizer.IsEnabled() {
		// Get observations for richer summary
		obsText, _ := h.obsStore.FormatForSummary(sess.ID)
		summary, err = h.summarizer.SummarizeWithObservations(req.Transcript, obsText)
		if err != nil {
			// Fallback: use raw transcript excerpt
			summary = fallbackSummary(req.Transcript)
		}
	} else {
		// No summarizer available, use raw excerpt
		summary = fallbackSummary(req.Transcript)
	}

	// Store as SESSION_SUMMARY memory
	storeReq := &models.StoreRequest{
		Namespace:  req.Namespace,
		Workspace:  req.Workspace,
		Content:    summary,
		MemoryType: models.MemoryTypeSessionSummary,
		Tier:       models.TierShort,
		Confidence: 0.7,
		Tags:       []string{"session-summary", "auto-generated"},
		Source:     "session_summarizer",
		SessionID:  req.SessionID,
	}

	storeResp, err := h.svc.Store(storeReq)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store summary: "+err.Error())
		return
	}

	// Link summary to session
	if storeResp.ID != "" {
		_ = h.sessStore.SetSummaryMemory(sess.ID, storeResp.ID)
	}

	writeJSON(w, http.StatusOK, models.SummarizeResponse{
		SessionID:       sess.ID,
		SummaryMemoryID: storeResp.ID,
		Summary:         summary,
	})
}

// ListSessions handles GET /sessions
func (h *SessionHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	sessions, err := h.sessStore.List(workspaceID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if sessions == nil {
		sessions = []*models.Session{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"sessions": sessions,
	})
}

// GetSession handles GET /sessions/{id}
func (h *SessionHandler) GetSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	sess, err := h.sessStore.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sess == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	writeJSON(w, http.StatusOK, sess)
}

// StoreObservation handles POST /sessions/{id}/observations
func (h *SessionHandler) StoreObservation(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")

	var req models.StoreObservationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.ToolName == "" {
		writeError(w, http.StatusBadRequest, "toolName is required")
		return
	}

	obs, err := h.obsStore.Insert(sessionID, &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, obs)
}

// ListObservations handles GET /sessions/{id}/observations
func (h *SessionHandler) ListObservations(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	observations, err := h.obsStore.ListBySession(sessionID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if observations == nil {
		observations = []*models.Observation{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"observations": observations,
	})
}

// fallbackSummary extracts a raw excerpt from the transcript when AI summarization is unavailable.
func fallbackSummary(transcript string) string {
	// Take last 1500 chars as summary
	if len(transcript) > 1500 {
		return transcript[len(transcript)-1500:]
	}
	return transcript
}
