package tests

import (
	"testing"

	"github.com/anthropics/clive/apps/memory/internal/models"
)

func TestSearchIndexResultTruncation(t *testing.T) {
	// Verify that SearchIndexResult has ContentPreview field
	result := models.SearchIndexResult{
		ID:             "test-id",
		Score:          0.85,
		MemoryType:     models.MemoryTypeGotcha,
		Tier:           models.TierShort,
		Confidence:     0.9,
		Tags:           []string{"test"},
		ImpactScore:    0.5,
		ContentPreview: "This is a preview...",
		CreatedAt:      1700000000,
	}

	if result.ContentPreview != "This is a preview..." {
		t.Errorf("expected preview text, got %q", result.ContentPreview)
	}

	if result.MemoryType != models.MemoryTypeGotcha {
		t.Errorf("expected GOTCHA type, got %s", result.MemoryType)
	}
}

func TestSearchIndexResponseStructure(t *testing.T) {
	resp := models.SearchIndexResponse{
		Results: []models.SearchIndexResult{
			{ID: "1", Score: 0.9, ContentPreview: "first result preview"},
			{ID: "2", Score: 0.8, ContentPreview: "second result preview"},
		},
		Meta: models.SearchMeta{
			TotalResults:  2,
			VectorResults: 1,
			BM25Results:   1,
			SearchTimeMs:  50,
		},
	}

	if len(resp.Results) != 2 {
		t.Errorf("expected 2 results, got %d", len(resp.Results))
	}

	if resp.Meta.TotalResults != 2 {
		t.Errorf("expected total 2, got %d", resp.Meta.TotalResults)
	}
}

func TestBatchGetRequestResponse(t *testing.T) {
	req := models.BatchGetRequest{
		IDs: []string{"id-1", "id-2", "id-3"},
	}

	if len(req.IDs) != 3 {
		t.Errorf("expected 3 IDs, got %d", len(req.IDs))
	}

	resp := models.BatchGetResponse{
		Memories: []*models.Memory{
			{ID: "id-1", Content: "full content 1"},
			{ID: "id-2", Content: "full content 2"},
		},
		Missing: []string{"id-3"},
	}

	if len(resp.Memories) != 2 {
		t.Errorf("expected 2 memories, got %d", len(resp.Memories))
	}

	if len(resp.Missing) != 1 {
		t.Errorf("expected 1 missing, got %d", len(resp.Missing))
	}
}

func TestTimelineRequestDefaults(t *testing.T) {
	req := models.TimelineRequest{
		MemoryID: "test-id",
	}

	// Default values should be zero, service layer handles defaults
	if req.WindowMinutes != 0 {
		t.Errorf("expected zero default, got %d", req.WindowMinutes)
	}
	if req.MaxResults != 0 {
		t.Errorf("expected zero default, got %d", req.MaxResults)
	}
}

func TestTimelineResponseStructure(t *testing.T) {
	resp := models.TimelineResponse{
		Anchor: &models.Memory{ID: "anchor-id", Content: "anchor content"},
		Before: []*models.Memory{
			{ID: "before-1", Content: "earlier memory"},
		},
		After: []*models.Memory{
			{ID: "after-1", Content: "later memory"},
		},
	}

	if resp.Anchor.ID != "anchor-id" {
		t.Errorf("expected anchor-id, got %s", resp.Anchor.ID)
	}

	if len(resp.Before) != 1 {
		t.Errorf("expected 1 before, got %d", len(resp.Before))
	}

	if len(resp.After) != 1 {
		t.Errorf("expected 1 after, got %d", len(resp.After))
	}
}
