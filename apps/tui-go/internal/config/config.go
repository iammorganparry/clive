package config

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// GlobalAuthConfig holds authentication credentials that should be shared across projects
type GlobalAuthConfig struct {
	LinearAPIKey string `json:"linear_api_key,omitempty"`
}

// Config represents the user's configuration
type Config struct {
	IssueTracker   IssueTracker      `json:"issue_tracker"`
	SetupCompleted bool              `json:"setup_completed"`
	Linear         *LinearConfig     `json:"linear,omitempty"`
	GlobalAuth     *GlobalAuthConfig `json:"-"` // Not serialized, loaded separately
}

// LinearConfig holds Linear-specific configuration (per-project)
type LinearConfig struct {
	TeamID   string `json:"team_id"`
	TeamSlug string `json:"team_slug"` // For display (e.g., "TEAM")
	TeamName string `json:"team_name"` // For display (e.g., "My Team")
	APIKey   string `json:"api_key,omitempty"` // DEPRECATED: Kept for migration only, moved to GlobalAuth
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

// loadFromPath loads config from a specific path
func loadFromPath(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// Load reads the config from disk, merging project config with global auth
func Load() (*Config, error) {
	// Try project config first (.clive/config.json in current directory)
	projectPath := projectConfigPath()
	projectCfg, projectErr := loadFromPath(projectPath)

	// Load global config for auth
	globalPath, err := globalConfigPath()
	if err != nil {
		return nil, err
	}
	globalCfg, globalErr := loadFromPath(globalPath)

	// Determine base config
	var cfg *Config
	if projectErr == nil {
		cfg = projectCfg
	} else if globalErr == nil {
		cfg = globalCfg
	} else {
		// No config exists, return default
		return DefaultConfig(), nil
	}

	// Initialize GlobalAuth
	cfg.GlobalAuth = &GlobalAuthConfig{}

	// Extract global auth from global config if available
	if globalErr == nil && globalCfg.Linear != nil && globalCfg.Linear.APIKey != "" {
		cfg.GlobalAuth.LinearAPIKey = globalCfg.Linear.APIKey
	}

	// MIGRATION: If project config has old-style APIKey, migrate it
	if cfg.Linear != nil && cfg.Linear.APIKey != "" {
		log.Printf("Migrating Linear API key from project to global config")
		cfg.GlobalAuth.LinearAPIKey = cfg.Linear.APIKey
		cfg.Linear.APIKey = ""
		// Save immediately to persist migration
		if err := Save(cfg); err != nil {
			log.Printf("Warning: failed to save migrated config: %v", err)
		}
	}

	return cfg, nil
}

// saveProjectConfig saves project-specific config (team selection, tracker type)
func saveProjectConfig(cfg *Config) error {
	dir := ".clive"
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	// Create project config with only project-specific fields
	projectCfg := &Config{
		IssueTracker:   cfg.IssueTracker,
		SetupCompleted: cfg.SetupCompleted,
		Linear:         cfg.Linear, // Team selection only (no API key)
	}

	data, err := json.MarshalIndent(projectCfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(projectConfigPath(), data, 0644)
}

// saveGlobalAuth saves global authentication credentials
func saveGlobalAuth(auth *GlobalAuthConfig) error {
	globalPath, err := globalConfigPath()
	if err != nil {
		return err
	}

	// Load existing global config if it exists
	existing := make(map[string]interface{})
	if data, err := os.ReadFile(globalPath); err == nil {
		json.Unmarshal(data, &existing)
	}

	// Update only the auth fields
	if auth.LinearAPIKey != "" {
		existing["linear_api_key"] = auth.LinearAPIKey
	}

	// Ensure directory exists
	dir, err := globalConfigDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(globalPath, data, 0644)
}

// Save writes the config, separating project data from global auth
func Save(cfg *Config) error {
	// Save project-specific data to .clive/config.json
	if err := saveProjectConfig(cfg); err != nil {
		return fmt.Errorf("failed to save project config: %w", err)
	}

	// Save global auth to ~/.clive/config.json (only if present)
	if cfg.GlobalAuth != nil && cfg.GlobalAuth.LinearAPIKey != "" {
		if err := saveGlobalAuth(cfg.GlobalAuth); err != nil {
			// Log warning but don't fail - project config is more important
			log.Printf("Warning: failed to save global auth: %v", err)
		}
	}

	return nil
}

// SaveToProject writes the config to the project-level location (.clive/config.json)
// Deprecated: Use Save() instead, which handles project/global separation
func SaveToProject(cfg *Config) error {
	return saveProjectConfig(cfg)
}

// SaveToGlobal writes the config to the global location (~/.clive/config.json)
// Deprecated: Use Save() instead, which handles project/global separation
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
