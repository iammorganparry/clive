package sessions

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Summarizer generates AI-compressed session summaries using Ollama.
type Summarizer struct {
	ollamaURL string
	model     string
	enabled   bool
	logger    *slog.Logger
	client    *http.Client
}

// NewSummarizer creates a new session summarizer.
func NewSummarizer(ollamaURL, model string, enabled bool, logger *slog.Logger) *Summarizer {
	return &Summarizer{
		ollamaURL: ollamaURL,
		model:     model,
		enabled:   enabled,
		logger:    logger,
		client: &http.Client{
			Timeout: 120 * time.Second, // LLM generation can be slow
		},
	}
}

// IsEnabled returns whether summarization is active.
func (s *Summarizer) IsEnabled() bool {
	return s.enabled
}

const summaryPrompt = `You are a session summarizer for a developer AI assistant. Analyze the transcript and produce a structured summary.

## Instructions
- Extract the key investigation path, decisions made, lessons learned, and next steps
- Be concise but specific — include file names, error messages, and tool names
- Focus on what would help a FUTURE session continue this work
- Output as plain text with clear section headers

## Format
INVESTIGATION: What was explored and why
DECISIONS: Key choices made and their reasoning
LESSONS: What worked, what didn't, gotchas discovered
NEXT STEPS: What remains to be done
FILES: Key files that were modified or relevant

## Transcript
%s`

// ollamaRequest is the request body for Ollama /api/generate.
type ollamaRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
}

// ollamaResponse is the response body from Ollama /api/generate.
type ollamaResponse struct {
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

// Summarize generates a structured summary from a session transcript.
// Returns the summary text, or an error if generation fails.
func (s *Summarizer) Summarize(transcript string) (string, error) {
	if !s.enabled {
		return "", fmt.Errorf("summarization disabled")
	}

	// Truncate transcript to ~8K tokens (~32K chars) to fit context window
	if len(transcript) > 32000 {
		// Keep first 8K and last 24K for recency bias
		transcript = transcript[:8000] + "\n\n[... middle truncated ...]\n\n" + transcript[len(transcript)-24000:]
	}

	prompt := fmt.Sprintf(summaryPrompt, transcript)

	reqBody := ollamaRequest{
		Model:  s.model,
		Prompt: prompt,
		Stream: false,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	url := strings.TrimRight(s.ollamaURL, "/") + "/api/generate"
	resp, err := s.client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("ollama generate: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ollama returned %d: %s", resp.StatusCode, string(respBody))
	}

	var ollamaResp ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return "", fmt.Errorf("decode ollama response: %w", err)
	}

	if ollamaResp.Response == "" {
		return "", fmt.Errorf("empty response from ollama")
	}

	return strings.TrimSpace(ollamaResp.Response), nil
}

// SummarizeWithObservations generates a summary incorporating tool observations.
func (s *Summarizer) SummarizeWithObservations(transcript string, observations string) (string, error) {
	if observations != "" {
		transcript = transcript + "\n\n## Tool Observations\n" + observations
	}
	return s.Summarize(transcript)
}
