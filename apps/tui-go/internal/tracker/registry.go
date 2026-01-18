package tracker

import (
	"fmt"

	"github.com/clive/tui-go/internal/config"
	"github.com/clive/tui-go/internal/linear"
)

// NewProvider creates a provider for the given tracker type
func NewProvider(trackerType config.IssueTracker) (Provider, error) {
	switch trackerType {
	case config.TrackerBeads:
		return NewBeadsProvider(), nil
	case config.TrackerLinear:
		return nil, fmt.Errorf("linear tracker requires config - use NewProviderWithConfig")
	default:
		return nil, fmt.Errorf("unknown tracker type: %s", trackerType)
	}
}

// NewProviderWithConfig creates a provider using the full configuration
func NewProviderWithConfig(cfg *config.Config) (Provider, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}

	switch cfg.IssueTracker {
	case config.TrackerBeads:
		return NewBeadsProvider(), nil
	case config.TrackerLinear:
		return newLinearProviderFromConfig(cfg)
	default:
		return nil, fmt.Errorf("unknown tracker type: %s", cfg.IssueTracker)
	}
}

// newLinearProviderFromConfig creates a Linear provider from config
func newLinearProviderFromConfig(cfg *config.Config) (Provider, error) {
	if cfg.Linear == nil || cfg.Linear.TeamID == "" {
		return nil, fmt.Errorf("Linear not configured - missing team ID")
	}

	// First try to use API key from config if available
	var token string
	if cfg.Linear.APIKey != "" {
		token = cfg.Linear.APIKey
	} else {
		// Fall back to getting token from Keychain (MCP OAuth)
		var err error
		token, err = linear.GetLinearTokenFromKeychain()
		if err != nil {
			return nil, fmt.Errorf("Linear not authenticated: %w", err)
		}
	}

	return NewLinearProvider(token, cfg.Linear.TeamID), nil
}
