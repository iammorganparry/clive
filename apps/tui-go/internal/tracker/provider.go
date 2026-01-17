package tracker

import (
	"github.com/clive/tui-go/internal/model"
)

// Provider defines the interface for issue tracking systems
type Provider interface {
	// Name returns the display name of the tracker
	Name() string

	// IsAvailable checks if the tracker is configured and accessible
	IsAvailable() bool

	// GetEpics returns all epics/projects
	// If filterByUser is true, only returns epics owned by current user
	GetEpics(filterByUser bool) []model.Session

	// GetEpicTasks returns all tasks under an epic
	GetEpicTasks(epicID string) []model.Task

	// ClearCache clears any cached data
	ClearCache()
}
