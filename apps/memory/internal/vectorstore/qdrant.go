package vectorstore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// QdrantClient interfaces with the Qdrant REST API for vector operations.
type QdrantClient struct {
	baseURL    string
	httpClient *http.Client
	dimension  int
}

func NewQdrantClient(baseURL string, dimension int) *QdrantClient {
	return &QdrantClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		dimension: dimension,
	}
}

// Point represents a vector point in Qdrant.
type Point struct {
	ID      string         `json:"id"`
	Vector  []float32      `json:"vector"`
	Payload map[string]any `json:"payload,omitempty"`
}

// SearchResult is a single scored result from Qdrant.
type SearchResult struct {
	ID      string         `json:"id"`
	Score   float64        `json:"score"`
	Payload map[string]any `json:"payload,omitempty"`
}

// HealthCheck verifies Qdrant connectivity.
func (c *QdrantClient) HealthCheck() error {
	resp, err := c.httpClient.Get(c.baseURL + "/healthz")
	if err != nil {
		return fmt.Errorf("qdrant health check: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("qdrant health check: status %d", resp.StatusCode)
	}
	return nil
}

// EnsureCollection creates a collection if it doesn't exist.
func (c *QdrantClient) EnsureCollection(name string) error {
	// Check if collection exists
	resp, err := c.httpClient.Get(c.baseURL + "/collections/" + name)
	if err != nil {
		return fmt.Errorf("check collection: %w", err)
	}
	resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return nil // Already exists
	}

	// Create collection
	body := map[string]any{
		"vectors": map[string]any{
			"size":     c.dimension,
			"distance": "Cosine",
		},
	}
	return c.put("/collections/"+name, body)
}

// Upsert inserts or updates a vector point in a collection.
func (c *QdrantClient) Upsert(collection string, points []Point) error {
	body := map[string]any{
		"points": points,
	}
	return c.put("/collections/"+collection+"/points", body)
}

// Search finds the nearest vectors in a collection.
func (c *QdrantClient) Search(collection string, vector []float32, limit int, minScore float64) ([]SearchResult, error) {
	body := map[string]any{
		"vector":      vector,
		"limit":       limit,
		"with_payload": true,
		"score_threshold": minScore,
	}

	respBody, err := c.post("/collections/"+collection+"/points/search", body)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Result []struct {
			ID      string         `json:"id"`
			Score   float64        `json:"score"`
			Payload map[string]any `json:"payload"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("decode search response: %w", err)
	}

	results := make([]SearchResult, len(resp.Result))
	for i, r := range resp.Result {
		results[i] = SearchResult{
			ID:      r.ID,
			Score:   r.Score,
			Payload: r.Payload,
		}
	}
	return results, nil
}

// DeletePoints removes points by their IDs from a collection.
func (c *QdrantClient) DeletePoints(collection string, ids []string) error {
	body := map[string]any{
		"points": ids,
	}
	_, err := c.post("/collections/"+collection+"/points/delete", body)
	return err
}

// CollectionExists checks if a collection exists.
func (c *QdrantClient) CollectionExists(name string) (bool, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/collections/" + name)
	if err != nil {
		return false, fmt.Errorf("check collection: %w", err)
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK, nil
}

func (c *QdrantClient) put(path string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPut, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant PUT %s: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant PUT %s: status %d: %s", path, resp.StatusCode, string(respBody))
	}
	return nil
}

func (c *QdrantClient) post(path string, body any) ([]byte, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(c.baseURL+path, "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("qdrant POST %s: %w", path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("qdrant POST %s: status %d: %s", path, resp.StatusCode, string(respBody))
	}
	return respBody, nil
}
