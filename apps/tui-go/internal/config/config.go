package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config represents the user's configuration
type Config struct {
	IssueTracker   IssueTracker  `json:"issue_tracker"`
	SetupCompleted bool          `json:"setup_completed"`
	Linear         *LinearConfig `json:"linear,omitempty"`
}

// LinearConfig holds Linear-specific configuration
type LinearConfig struct {
	TeamID   string `json:"team_id"`
	TeamSlug string `json:"team_slug"` // For display (e.g., "TEAM")
	TeamName string `json:"team_name"` // For display (e.g., "My Team")
	APIKey   string `json:"api_key"`   // Personal API key for direct API access
}

// DefaultConfig returns the default configuration
func DefaultConfig() *Config {
	return &Config{
		IssueTracker: TrackerBeads,
	}
}

// globalConfigDir returns the global config directory path (~/.clive)
func globalConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".clive"), nil
}

// globalConfigPath returns the global config file path (~/.clive/config.json)
func globalConfigPath() (string, error) {
	dir, err := globalConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// projectConfigPath returns the project-level config path (.clive/config.json in cwd)
func projectConfigPath() string {
	return filepath.Join(".clive", "config.json")
}

// configDir returns the config directory path (~/.clive) - kept for compatibility
func configDir() (string, error) {
	return globalConfigDir()
}

// configPath returns the full config file path - kept for compatibility
func configPath() (string, error) {
	return globalConfigPath()
}

// Exists checks if a config file exists (project or global)
func Exists() bool {
	// Check project config first
	if _, err := os.Stat(projectConfigPath()); err == nil {
		return true
	}
	// Check global config
	path, err := globalConfigPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

// Load reads the config from disk, checking project config first, then global
func Load() (*Config, error) {
	// Try project config first (.clive/config.json in current directory)
	projectPath := projectConfigPath()
	if data, err := os.ReadFile(projectPath); err == nil {
		var cfg Config
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, err
		}
		return &cfg, nil
	}

	// Fall back to global config (~/.clive/config.json)
	globalPath, err := globalConfigPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(globalPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No config exists, return default (don't auto-create)
			return DefaultConfig(), nil
		}
		return nil, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// Save writes the config to both project and global locations
func Save(cfg *Config) error {
	// Save to project config (.clive/config.json)
	if err := SaveToProject(cfg); err != nil {
		// If project save fails (e.g., no write permission), continue to global
		_ = err
	}

	// Also save to global config for credentials/defaults
	return SaveToGlobal(cfg)
}

// SaveToProject writes the config to the project-level location (.clive/config.json)
func SaveToProject(cfg *Config) error {
	dir := ".clive"
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(projectConfigPath(), data, 0644)
}

// SaveToGlobal writes the config to the global location (~/.clive/config.json)
func SaveToGlobal(cfg *Config) error {
	dir, err := globalConfigDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	path, err := globalConfigPath()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}
