package setup

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type ClaudeSettings struct {
	McpServers                 map[string]interface{} `json:"mcpServers,omitempty"`
	EnabledMcpjsonServers      []string               `json:"enabledMcpjsonServers,omitempty"`
	EnableAllProjectMcpServers bool                   `json:"enableAllProjectMcpServers,omitempty"`
	Permissions                map[string]interface{} `json:"permissions,omitempty"`
}

type McpConfig struct {
	McpServers map[string]interface{} `json:"mcpServers"`
}

// EnsureLinearMcpConfigured checks if Linear MCP is configured in project settings
// and configures it if missing. Returns true if configuration was added.
func EnsureLinearMcpConfigured() (bool, error) {
	claudeDir := ".claude"
	settingsPath := filepath.Join(claudeDir, "settings.local.json")
	mcpPath := ".mcp.json"

	// Ensure .claude directory exists
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		return false, fmt.Errorf("failed to create .claude directory: %w", err)
	}

	// Check/create settings.local.json
	settingsUpdated := false
	var settings ClaudeSettings

	if data, err := os.ReadFile(settingsPath); err == nil {
		// File exists, parse it
		if err := json.Unmarshal(data, &settings); err != nil {
			return false, fmt.Errorf("failed to parse settings: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return false, fmt.Errorf("failed to read settings: %w", err)
	}

	// Check if Linear is configured
	linearConfigured := false
	if settings.McpServers != nil {
		if _, ok := settings.McpServers["linear"]; ok {
			linearConfigured = true
		}
	}
	for _, server := range settings.EnabledMcpjsonServers {
		if server == "linear" {
			linearConfigured = true
			break
		}
	}

	// If not configured, add it
	if !linearConfigured {
		// Enable .mcp.json server loading
		if settings.EnabledMcpjsonServers == nil {
			settings.EnabledMcpjsonServers = []string{}
		}
		if !contains(settings.EnabledMcpjsonServers, "linear") {
			settings.EnabledMcpjsonServers = append(settings.EnabledMcpjsonServers, "linear")
		}
		settings.EnableAllProjectMcpServers = true
		settingsUpdated = true
	}

	// Write settings if updated
	if settingsUpdated {
		data, err := json.MarshalIndent(settings, "", "  ")
		if err != nil {
			return false, fmt.Errorf("failed to marshal settings: %w", err)
		}
		if err := os.WriteFile(settingsPath, data, 0644); err != nil {
			return false, fmt.Errorf("failed to write settings: %w", err)
		}
	}

	// Check/create .mcp.json
	mcpUpdated := false
	if _, err := os.Stat(mcpPath); os.IsNotExist(err) {
		// Create default .mcp.json with Linear using Claude Code's HTTP endpoint
		mcpConfig := McpConfig{
			McpServers: map[string]interface{}{
				"linear": map[string]interface{}{
					"type": "http",
					"url":  "https://mcp.linear.app/mcp",
				},
			},
		}
		data, err := json.MarshalIndent(mcpConfig, "", "  ")
		if err != nil {
			return false, fmt.Errorf("failed to marshal mcp config: %w", err)
		}
		if err := os.WriteFile(mcpPath, data, 0644); err != nil {
			return false, fmt.Errorf("failed to write mcp config: %w", err)
		}
		mcpUpdated = true
	}

	return settingsUpdated || mcpUpdated, nil
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
