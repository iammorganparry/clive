package tracker

import (
	"fmt"

	"github.com/clive/tui-go/internal/config"
)

// NewProvider creates a provider for the given tracker type
func NewProvider(trackerType config.IssueTracker) (Provider, error) {
	switch trackerType {
	case config.TrackerBeads:
		return NewBeadsProvider(), nil
	case config.TrackerLinear:
		return nil, fmt.Errorf("linear tracker not yet implemented")
	default:
		return nil, fmt.Errorf("unknown tracker type: %s", trackerType)
	}
}
