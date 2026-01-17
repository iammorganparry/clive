package tracker

import (
	"github.com/clive/tui-go/internal/beads"
	"github.com/clive/tui-go/internal/model"
)

// BeadsProvider implements Provider for the Beads issue tracker
type BeadsProvider struct{}

// NewBeadsProvider creates a new Beads provider
func NewBeadsProvider() *BeadsProvider {
	return &BeadsProvider{}
}

// Name returns the display name
func (p *BeadsProvider) Name() string {
	return "Beads"
}

// IsAvailable checks if beads is configured
func (p *BeadsProvider) IsAvailable() bool {
	return beads.IsAvailable()
}

// GetEpics returns all epics from beads
func (p *BeadsProvider) GetEpics(filterByUser bool) []model.Session {
	return beads.GetEpics(filterByUser)
}

// GetEpicTasks returns all tasks under an epic
func (p *BeadsProvider) GetEpicTasks(epicID string) []model.Task {
	return beads.GetEpicTasks(epicID)
}

// ClearCache clears the beads cache
func (p *BeadsProvider) ClearCache() {
	beads.ClearCache()
}
