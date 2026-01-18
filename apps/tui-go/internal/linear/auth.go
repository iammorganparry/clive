package linear

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	// KeychainService is the service name Claude Code uses for credentials
	KeychainService = "Claude Code-credentials"

	// MCPConfigFileName is the name of the MCP configuration file
	MCPConfigFileName = ".mcp.json"

	// LinearMCPName is the name used for Linear in MCP config
	LinearMCPName = "linear"

	// LinearMCPURL is the Linear MCP endpoint
	LinearMCPURL = "https://mcp.linear.app/mcp"
)

// ClaudeCredentials represents the structure stored in Keychain
// Note: The JSON is stored hex-encoded in the Keychain
type ClaudeCredentials struct {
	ClaudeAIOAuth *OAuthCredentials `json:"claudeAiOauth,omitempty"`
	// MCP OAuth tokens are stored with keys like "plugin:linear:linear|..."
	MCPOAuth map[string]*MCPOAuthCredentials `json:"mcpOAuth,omitempty"`
}

// OAuthCredentials represents OAuth token data for Claude AI
type OAuthCredentials struct {
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	ExpiresAt    int64    `json:"expiresAt"`
	Scopes       []string `json:"scopes,omitempty"`
}

// MCPOAuthCredentials represents OAuth token data for MCP servers
type MCPOAuthCredentials struct {
	ServerName   string `json:"serverName"`
	ServerURL    string `json:"serverUrl"`
	ClientID     string `json:"clientId"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    int64  `json:"expiresAt"`
	Scope        string `json:"scope"`
}

// GetLinearTokenFromKeychain retrieves the Linear OAuth token from macOS Keychain
// Returns the access token or an error if not found/not authenticated
func GetLinearTokenFromKeychain() (string, error) {
	// Use security command to read from Keychain
	cmd := exec.Command("security", "find-generic-password", "-s", KeychainService, "-w")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("no credentials found in Keychain: %w", err)
	}

	hexStr := strings.TrimSpace(string(output))
	if hexStr == "" {
		return "", fmt.Errorf("empty credentials in Keychain")
	}

	// Credentials are stored as hex-encoded JSON
	decoded, err := hex.DecodeString(hexStr)
	if err != nil {
		return "", fmt.Errorf("failed to decode hex credentials: %w", err)
	}

	return parseCredentialsJSON(string(decoded))
}

// parseCredentialsJSON parses the credential JSON and extracts the Linear token.
// It handles various edge cases including truncated JSON and missing outer braces.
func parseCredentialsJSON(content string) (string, error) {
	if content == "" {
		return "", fmt.Errorf("empty credentials")
	}

	// Skip any leading non-printable bytes (header bytes)
	for len(content) > 0 && content[0] < 32 {
		content = content[1:]
	}

	if content == "" {
		return "", fmt.Errorf("empty credentials after stripping header")
	}

	// Prepare JSON for parsing
	var credJSON string
	if content[0] == '{' {
		credJSON = content
	} else if content[0] == '"' {
		// Wrap in braces to make valid JSON
		credJSON = "{" + content + "}"
	} else {
		return "", fmt.Errorf("invalid credentials format: unexpected start character %q", string(content[0]))
	}

	// Try to parse as complete JSON first
	var creds ClaudeCredentials
	if err := json.Unmarshal([]byte(credJSON), &creds); err == nil {
		// Successfully parsed - look for Linear token
		if creds.MCPOAuth != nil {
			for key, token := range creds.MCPOAuth {
				if strings.Contains(key, "linear") && token != nil && token.AccessToken != "" {
					return token.AccessToken, nil
				}
			}
		}
		return "", fmt.Errorf("Linear OAuth token not found in Keychain - please authenticate with Linear MCP")
	}

	// JSON parsing failed (likely truncated) - try fallback extraction
	if token, found := extractLinearTokenFallback(content); found {
		return token, nil
	}

	return "", fmt.Errorf("Linear OAuth token not found in Keychain - please authenticate with Linear MCP")
}

// extractLinearTokenFallback attempts to extract a Linear token from potentially
// truncated or malformed JSON using string matching.
func extractLinearTokenFallback(content string) (string, bool) {
	// Look for patterns like:
	// "plugin:linear:linear|..." or "linear|..." followed by accessToken
	// Pattern: "linear...accessToken":"<token>"

	// Find all potential Linear entries
	linearPatterns := []string{
		`"plugin:linear:linear|`,
		`"linear|`,
	}

	for _, pattern := range linearPatterns {
		idx := strings.Index(content, pattern)
		if idx == -1 {
			continue
		}

		// Find the accessToken within this entry
		searchStart := idx
		accessTokenKey := `"accessToken":"`
		tokenIdx := strings.Index(content[searchStart:], accessTokenKey)
		if tokenIdx == -1 {
			continue
		}

		// Extract the token value
		tokenStart := searchStart + tokenIdx + len(accessTokenKey)
		if tokenStart >= len(content) {
			continue
		}

		// Find the closing quote
		tokenEnd := strings.Index(content[tokenStart:], `"`)
		if tokenEnd == -1 {
			// Token might be truncated, skip this entry
			continue
		}

		token := content[tokenStart : tokenStart+tokenEnd]
		if token != "" {
			return token, true
		}
	}

	return "", false
}

// IsLinearAuthenticated checks if there's a valid Linear token in Keychain
// Note: We don't validate the token via API call because the MCP OAuth tokens
// are specific to the MCP protocol and don't work with direct Linear API calls.
// If the token exists in Keychain, we trust that Claude Code has validated it.
func IsLinearAuthenticated() bool {
	token, err := GetLinearTokenFromKeychain()
	return err == nil && token != ""
}

// MCPConfig represents the .mcp.json configuration file
type MCPConfig map[string]MCPServerConfig

// MCPServerConfig represents a single MCP server configuration
type MCPServerConfig struct {
	Type    string            `json:"type,omitempty"`
	URL     string            `json:"url,omitempty"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// IsLinearMCPConfigured checks if Linear MCP is configured in .mcp.json
func IsLinearMCPConfigured() bool {
	configPath := findMCPConfigPath()
	if configPath == "" {
		return false
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return false
	}

	var config MCPConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return false
	}

	_, exists := config[LinearMCPName]
	return exists
}

// findMCPConfigPath finds the .mcp.json file in current dir or parents
func findMCPConfigPath() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}

	// Check current directory and walk up
	dir := cwd
	for {
		configPath := filepath.Join(dir, MCPConfigFileName)
		if _, err := os.Stat(configPath); err == nil {
			return configPath
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	return ""
}

// ConfigureLinearMCP adds Linear MCP to the configuration
// This spawns `claude mcp add` to configure Linear
// Returns nil if already configured or successfully added
func ConfigureLinearMCP() error {
	// Check if already configured
	if IsLinearMCPConfigured() {
		return nil
	}

	cmd := exec.Command("claude", "mcp", "add", "--transport", "http", "--scope", "project", LinearMCPName, LinearMCPURL)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if error is just "already exists" - that's fine
		if strings.Contains(string(output), "already exists") {
			return nil
		}
		return fmt.Errorf("%s: %w", string(output), err)
	}
	return nil
}

// GetLinearAuthCommand returns an exec.Cmd for running Claude interactively.
// User will need to type /mcp, select Linear, and authenticate.
func GetLinearAuthCommand() *exec.Cmd {
	return exec.Command("claude")
}
