package linear

import (
	"strings"
	"testing"
)

func TestParseCredentials(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantToken   string
		wantErr     bool
		errContains string
	}{
		{
			name:      "complete JSON with mcpOAuth",
			input:     `{"claudeAiOauth":{"accessToken":"claude-token"},"mcpOAuth":{"plugin:linear:linear|abc123":{"accessToken":"linear-token-123"}}}`,
			wantToken: "linear-token-123",
			wantErr:   false,
		},
		{
			name:      "JSON without outer braces",
			input:     `"claudeAiOauth":{"accessToken":"claude-token"},"mcpOAuth":{"plugin:linear:linear|abc123":{"accessToken":"linear-token-456"}}`,
			wantToken: "linear-token-456",
			wantErr:   false,
		},
		{
			name:      "multiple linear entries - uses first found",
			input:     `{"mcpOAuth":{"plugin:linear:linear|first":{"accessToken":"first-token"},"linear|second":{"accessToken":"second-token"}}}`,
			wantToken: "", // map iteration order is random, so we just check it finds one
			wantErr:   false,
		},
		{
			name:      "truncated JSON but linear token complete",
			input:     `"claudeAiOauth":{"accessToken":"x"},"mcpOAuth":{"plugin:linear:linear|abc":{"accessToken":"complete-linear-token"},"other|truncated":{"accessToken":"trunc`,
			wantToken: "complete-linear-token",
			wantErr:   false,
		},
		{
			name:        "no linear token",
			input:       `{"claudeAiOauth":{"accessToken":"claude-token"},"mcpOAuth":{"other:server":{"accessToken":"other-token"}}}`,
			wantToken:   "",
			wantErr:     true,
			errContains: "Linear OAuth token not found",
		},
		{
			name:        "empty mcpOAuth",
			input:       `{"claudeAiOauth":{"accessToken":"claude-token"},"mcpOAuth":{}}`,
			wantToken:   "",
			wantErr:     true,
			errContains: "Linear OAuth token not found",
		},
		{
			name:        "empty input",
			input:       ``,
			wantToken:   "",
			wantErr:     true,
			errContains: "empty credentials",
		},
		{
			name:      "with leading control bytes",
			input:     "\x07" + `"claudeAiOauth":{},"mcpOAuth":{"linear|x":{"accessToken":"token-with-header"}}`,
			wantToken: "token-with-header",
			wantErr:   false,
		},
		{
			name:      "multiple control bytes",
			input:     "\x00\x01\x07\x1f" + `"mcpOAuth":{"plugin:linear:linear|x":{"accessToken":"token123"}}`,
			wantToken: "token123",
			wantErr:   false,
		},
		{
			name:        "only control bytes",
			input:       "\x00\x01\x07",
			wantToken:   "",
			wantErr:     true,
			errContains: "empty credentials after stripping",
		},
		{
			name:      "real-world format with multiple MCP servers",
			input:     `"claudeAiOauth":{"accessToken":"sk-ant-xxx"},"mcpOAuth":{"plugin:linear:linear|abc":{"serverName":"plugin:linear:linear","serverUrl":"https://mcp.linear.app/mcp","clientId":"xxx","accessToken":"uuid-token-here","expiresAt":1234567890},"other|def":{"accessToken":"other-token"}}`,
			wantToken: "uuid-token-here",
			wantErr:   false,
		},
		{
			name:      "linear entry at end truncated but first complete",
			input:     `"mcpOAuth":{"plugin:linear:linear|first":{"accessToken":"first-complete"},"linear|second":{"accessToken":"second-trunca`,
			wantToken: "first-complete",
			wantErr:   false,
		},
		{
			name:        "severely truncated - no complete token",
			input:       `"mcpOAuth":{"plugin:linear:linear|x":{"accessTok`,
			wantToken:   "",
			wantErr:     true,
			errContains: "Linear OAuth token not found",
		},
		{
			name:        "invalid start character",
			input:       `invalid json`,
			wantToken:   "",
			wantErr:     true,
			errContains: "unexpected start character",
		},
		{
			name:      "null mcpOAuth value in valid JSON",
			input:     `{"claudeAiOauth":{},"mcpOAuth":null}`,
			wantToken: "",
			wantErr:   true,
			errContains: "Linear OAuth token not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := parseCredentialsJSON(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errContains)
					return
				}
				if tt.errContains != "" && !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("error %q should contain %q", err.Error(), tt.errContains)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			// For the random order test, just check we got a token
			if tt.wantToken == "" && token != "" {
				return // OK - found some token
			}

			if token != tt.wantToken {
				t.Errorf("got token %q, want %q", token, tt.wantToken)
			}
		})
	}
}

func TestExtractLinearTokenFallback(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantToken string
		wantFound bool
	}{
		{
			name:      "extract from truncated JSON",
			input:     `"mcpOAuth":{"plugin:linear:linear|abc":{"accessToken":"found-token","other":"truncated...`,
			wantToken: "found-token",
			wantFound: true,
		},
		{
			name:      "extract with serverUrl confirmation",
			input:     `"linear|x":{"serverUrl":"https://mcp.linear.app/mcp","accessToken":"linear-api-token"}`,
			wantToken: "linear-api-token",
			wantFound: true,
		},
		{
			name:      "no linear token pattern",
			input:     `"other|x":{"accessToken":"not-linear"}`,
			wantToken: "",
			wantFound: false,
		},
		{
			name:      "empty accessToken",
			input:     `"linear|x":{"accessToken":""}`,
			wantToken: "",
			wantFound: false,
		},
		{
			name:      "plugin:linear:linear pattern",
			input:     `"plugin:linear:linear|hash123":{"accessToken":"plugin-token-value"}`,
			wantToken: "plugin-token-value",
			wantFound: true,
		},
		{
			name:      "linear|hash pattern",
			input:     `"linear|abcdef":{"accessToken":"linear-hash-token"}`,
			wantToken: "linear-hash-token",
			wantFound: true,
		},
		{
			name:      "accessToken before serverUrl",
			input:     `"plugin:linear:linear|x":{"accessToken":"token-first","serverUrl":"https://mcp.linear.app/mcp"}`,
			wantToken: "token-first",
			wantFound: true,
		},
		{
			name:      "accessToken after other fields",
			input:     `"plugin:linear:linear|x":{"serverName":"linear","serverUrl":"url","clientId":"id","accessToken":"token-after-fields"}`,
			wantToken: "token-after-fields",
			wantFound: true,
		},
		{
			name:      "token with special characters",
			input:     `"plugin:linear:linear|x":{"accessToken":"uuid-123:session-456:token-789"}`,
			wantToken: "uuid-123:session-456:token-789",
			wantFound: true,
		},
		{
			name:      "multiple linear entries takes first plugin:linear:linear",
			input:     `"plugin:linear:linear|first":{"accessToken":"first-plugin-token"},"linear|second":{"accessToken":"second-token"}`,
			wantToken: "first-plugin-token",
			wantFound: true,
		},
		{
			name:      "truncated after accessToken key",
			input:     `"plugin:linear:linear|x":{"accessToken":"`,
			wantToken: "",
			wantFound: false,
		},
		{
			name:      "truncated in middle of token",
			input:     `"plugin:linear:linear|x":{"accessToken":"partial-tok`,
			wantToken: "",
			wantFound: false,
		},
		{
			name:      "empty string",
			input:     ``,
			wantToken: "",
			wantFound: false,
		},
		{
			name:      "just whitespace",
			input:     `   `,
			wantToken: "",
			wantFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, found := extractLinearTokenFallback(tt.input)
			if found != tt.wantFound {
				t.Errorf("got found=%v, want %v", found, tt.wantFound)
			}
			if token != tt.wantToken {
				t.Errorf("got token %q, want %q", token, tt.wantToken)
			}
		})
	}
}

func TestParseCredentials_RealWorldFormat(t *testing.T) {
	// Test with format matching actual Claude Code Keychain data
	realWorldInput := "\x07" + `"claudeAiOauth":{"accessToken":"sk-ant-oat01-xxx","refreshToken":"sk-ant-ort01-xxx","expiresAt":1768697712950,"scopes":["user:inference"]},"mcpOAuth":{"plugin:linear:linear|638130d5ab3558f4":{"serverName":"plugin:linear:linear","serverUrl":"https://mcp.linear.app/mcp","clientId":"3tLvVVhCRhZtaznT","accessToken":"03e43548-ecbc-4e52-8371-5a5e74eae1d6:jfSt0fzZFhY9Sc29:mzbJLeUPTfqmVhKlKPiSHct2qOsG85Ap","expiresAt":1768588065755,"refreshToken":"03e43548-ecbc-4e52-8371-5a5e74eae1d6:jfSt0fzZFhY9Sc29:EumM5EFoID0859_NKtAgN6ifSTb3yPmP","scope":""},"other|59e4938976c99701":{"accessToken":"other-token"}}`

	token, err := parseCredentialsJSON(realWorldInput)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedToken := "03e43548-ecbc-4e52-8371-5a5e74eae1d6:jfSt0fzZFhY9Sc29:mzbJLeUPTfqmVhKlKPiSHct2qOsG85Ap"
	if token != expectedToken {
		t.Errorf("got token %q, want %q", token, expectedToken)
	}
}

func TestParseCredentials_TruncatedRealWorld(t *testing.T) {
	// Test with truncated real-world format (simulating Keychain size limit)
	truncatedInput := "\x07" + `"claudeAiOauth":{"accessToken":"sk-ant-xxx"},"mcpOAuth":{"plugin:linear:linear|abc":{"serverName":"plugin:linear:linear","serverUrl":"https://mcp.linear.app/mcp","accessToken":"complete-token-123"},"linear|def":{"accessToken":"trunc`

	token, err := parseCredentialsJSON(truncatedInput)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if token != "complete-token-123" {
		t.Errorf("got token %q, want %q", token, "complete-token-123")
	}
}
