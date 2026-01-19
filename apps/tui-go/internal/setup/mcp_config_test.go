package setup

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureLinearMcpConfigured(t *testing.T) {
	// Create a temporary directory for testing
	tmpDir, err := os.MkdirTemp("", "clive-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Change to temp directory
	originalWd, _ := os.Getwd()
	defer os.Chdir(originalWd)
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("Failed to change to temp dir: %v", err)
	}

	// Test 1: Fresh project (no config files)
	t.Run("Fresh project creates config files", func(t *testing.T) {
		configured, err := EnsureLinearMcpConfigured()
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if !configured {
			t.Error("Expected configuration to be added")
		}

		// Verify .claude/settings.local.json was created
		settingsPath := filepath.Join(".claude", "settings.local.json")
		if _, err := os.Stat(settingsPath); os.IsNotExist(err) {
			t.Error("Expected .claude/settings.local.json to be created")
		}

		// Verify settings content
		data, err := os.ReadFile(settingsPath)
		if err != nil {
			t.Fatalf("Failed to read settings: %v", err)
		}
		var settings ClaudeSettings
		if err := json.Unmarshal(data, &settings); err != nil {
			t.Fatalf("Failed to parse settings: %v", err)
		}
		if !settings.EnableAllProjectMcpServers {
			t.Error("Expected EnableAllProjectMcpServers to be true")
		}
		if !contains(settings.EnabledMcpjsonServers, "linear") {
			t.Error("Expected 'linear' in EnabledMcpjsonServers")
		}

		// Verify .mcp.json was created
		mcpPath := ".mcp.json"
		if _, err := os.Stat(mcpPath); os.IsNotExist(err) {
			t.Error("Expected .mcp.json to be created")
		}

		// Verify mcp.json content
		data, err = os.ReadFile(mcpPath)
		if err != nil {
			t.Fatalf("Failed to read mcp.json: %v", err)
		}
		var mcpConfig McpConfig
		if err := json.Unmarshal(data, &mcpConfig); err != nil {
			t.Fatalf("Failed to parse mcp.json: %v", err)
		}
		if _, ok := mcpConfig.McpServers["linear"]; !ok {
			t.Error("Expected 'linear' server in mcp.json")
		}
	})

	// Test 2: Already configured (should not modify)
	t.Run("Already configured project does not modify", func(t *testing.T) {
		configured, err := EnsureLinearMcpConfigured()
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if configured {
			t.Error("Expected no configuration changes (already configured)")
		}
	})
}
