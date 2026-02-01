package tests

import (
	"testing"

	"github.com/anthropics/clive/apps/memory/internal/models"
)

func TestSessionSummaryMemoryType(t *testing.T) {
	mt := models.MemoryTypeSessionSummary
	if !mt.IsValid() {
		t.Error("SESSION_SUMMARY should be a valid memory type")
	}
	if string(mt) != "SESSION_SUMMARY" {
		t.Errorf("expected SESSION_SUMMARY, got %s", mt)
	}
}

func TestSessionSummaryInitialStability(t *testing.T) {
	stability, ok := models.InitialStability[models.MemoryTypeSessionSummary]
	if !ok {
		t.Fatal("SESSION_SUMMARY should have an initial stability")
	}
	if stability != 3.0 {
		t.Errorf("expected stability 3.0, got %f", stability)
	}
}

func TestSessionStructure(t *testing.T) {
	sess := models.Session{
		ID:          "test-session",
		WorkspaceID: "ws-123",
		StartedAt:   1700000000,
		PromptCount: 5,
	}

	if sess.ID != "test-session" {
		t.Errorf("expected test-session, got %s", sess.ID)
	}
	if sess.EndedAt != nil {
		t.Error("expected nil EndedAt")
	}
	if sess.PromptCount != 5 {
		t.Errorf("expected 5, got %d", sess.PromptCount)
	}
}

func TestObservationStructure(t *testing.T) {
	obs := models.Observation{
		ID:        "obs-1",
		SessionID: "sess-1",
		ToolName:  "Write",
		Input:     "file.go",
		Output:    "success",
		Success:   true,
		CreatedAt: 1700000000,
		Sequence:  1,
	}

	if obs.ToolName != "Write" {
		t.Errorf("expected Write, got %s", obs.ToolName)
	}
	if !obs.Success {
		t.Error("expected success to be true")
	}
}

func TestSummarizeRequestValidation(t *testing.T) {
	req := models.SummarizeRequest{
		SessionID:  "sess-1",
		Workspace:  "/test/workspace",
		Transcript: "User asked about X. Assistant did Y.",
	}

	if req.SessionID == "" {
		t.Error("expected non-empty sessionId")
	}
	if req.Transcript == "" {
		t.Error("expected non-empty transcript")
	}
}

func TestSummarizeResponse(t *testing.T) {
	resp := models.SummarizeResponse{
		SessionID:       "sess-1",
		SummaryMemoryID: "mem-1",
		Summary:         "INVESTIGATION: Explored X. DECISIONS: Chose Y.",
	}

	if resp.SummaryMemoryID == "" {
		t.Error("expected non-empty summaryMemoryId")
	}
}
