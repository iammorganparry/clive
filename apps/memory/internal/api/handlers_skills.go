package api

import (
	"net/http"

	"github.com/anthropics/clive/apps/memory/internal/skills"
)

// SkillHandler handles skill-related API endpoints.
type SkillHandler struct {
	syncSvc *skills.SyncService
}

// NewSkillHandler creates a new SkillHandler.
func NewSkillHandler(syncSvc *skills.SyncService) *SkillHandler {
	return &SkillHandler{syncSvc: syncSvc}
}

// syncRequest is the optional body for POST /skills/sync.
type syncRequest struct {
	Dirs []string `json:"dirs"`
}

// Sync handles POST /skills/sync
func (h *SkillHandler) Sync(w http.ResponseWriter, r *http.Request) {
	var req syncRequest
	// Body is optional - ignore decode errors
	_ = decodeJSON(r, &req)

	var result *skills.SyncResult
	var err error

	if len(req.Dirs) > 0 {
		result, err = h.syncSvc.SyncDirs(req.Dirs)
	} else {
		result, err = h.syncSvc.Sync()
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// skillListItem is a single skill in the GET /skills response.
type skillListItem struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}

// skillListResponse is the response for GET /skills.
type skillListResponse struct {
	Skills []skillListItem `json:"skills"`
}

// List handles GET /skills
func (h *SkillHandler) List(w http.ResponseWriter, r *http.Request) {
	metas, err := h.syncSvc.ListSkills()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	items := make([]skillListItem, len(metas))
	for i, m := range metas {
		items[i] = skillListItem{
			Name:        m.Name,
			Description: m.Description,
			Tags:        []string{"skill", "skill:" + m.Name},
		}
	}

	writeJSON(w, http.StatusOK, skillListResponse{Skills: items})
}
