package linear

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	// LinearAPIURL is the Linear GraphQL API endpoint
	LinearAPIURL = "https://api.linear.app/graphql"
)

// Client is a Linear GraphQL API client
type Client struct {
	token      string
	httpClient *http.Client
	baseURL    string
}

// NewClient creates a new Linear API client
func NewClient(token string) *Client {
	return &Client{
		token: token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		baseURL: LinearAPIURL,
	}
}

// GraphQLRequest represents a GraphQL request
type GraphQLRequest struct {
	Query     string                 `json:"query"`
	Variables map[string]interface{} `json:"variables,omitempty"`
}

// GraphQLResponse represents a GraphQL response
type GraphQLResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []GraphQLError  `json:"errors,omitempty"`
}

// GraphQLError represents a GraphQL error
type GraphQLError struct {
	Message   string `json:"message"`
	Locations []struct {
		Line   int `json:"line"`
		Column int `json:"column"`
	} `json:"locations,omitempty"`
	Path []interface{} `json:"path,omitempty"`
}

// Do executes a GraphQL request and unmarshals the response into result
func (c *Client) Do(query string, variables map[string]interface{}, result interface{}) error {
	req := GraphQLRequest{
		Query:     query,
		Variables: variables,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", c.baseURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", c.token)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("execute request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var gqlResp GraphQLResponse
	if err := json.Unmarshal(respBody, &gqlResp); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}

	if len(gqlResp.Errors) > 0 {
		return fmt.Errorf("GraphQL error: %s", gqlResp.Errors[0].Message)
	}

	if result != nil {
		if err := json.Unmarshal(gqlResp.Data, result); err != nil {
			return fmt.Errorf("unmarshal data: %w", err)
		}
	}

	return nil
}

// GetViewer returns the current authenticated user and their teams
func (c *Client) GetViewer() (*Viewer, error) {
	var result struct {
		Viewer Viewer `json:"viewer"`
	}

	if err := c.Do(queryViewer, nil, &result); err != nil {
		return nil, err
	}

	return &result.Viewer, nil
}

// GetTeams returns all teams the user has access to
func (c *Client) GetTeams() ([]Team, error) {
	viewer, err := c.GetViewer()
	if err != nil {
		return nil, err
	}
	return viewer.Teams.Nodes, nil
}

// GetParentIssues returns all parent issues (issues with sub-issues, no parent) for a team (with pagination)
func (c *Client) GetParentIssues(teamID string) ([]Issue, error) {
	var result struct {
		Team struct {
			Issues IssueConnection `json:"issues"`
		} `json:"team"`
	}

	allIssues := make([]Issue, 0)
	cursor := ""

	// Pagination loop
	for {
		variables := map[string]interface{}{
			"teamId": teamID,
		}
		if cursor != "" {
			variables["after"] = cursor
		}

		if err := c.Do(queryParentIssues, variables, &result); err != nil {
			return nil, err
		}

		allIssues = append(allIssues, result.Team.Issues.Nodes...)

		// Check if more pages exist
		if !result.Team.Issues.PageInfo.HasNextPage {
			break
		}
		cursor = result.Team.Issues.PageInfo.EndCursor
	}

	// Filter to only parent issues (has children, no parent)
	var parents []Issue
	for _, issue := range allIssues {
		if issue.IsParentIssue() {
			parents = append(parents, issue)
		}
	}

	return parents, nil
}

// GetAssignedIssues returns all issues assigned to the current user (not sub-issues) (with pagination)
func (c *Client) GetAssignedIssues(teamID string) ([]Issue, error) {
	var result struct {
		Team struct {
			Issues IssueConnection `json:"issues"`
		} `json:"team"`
	}

	allIssues := make([]Issue, 0)
	cursor := ""

	// Pagination loop
	for {
		variables := map[string]interface{}{
			"teamId": teamID,
		}
		if cursor != "" {
			variables["after"] = cursor
		}

		if err := c.Do(queryAssignedIssues, variables, &result); err != nil {
			return nil, err
		}

		allIssues = append(allIssues, result.Team.Issues.Nodes...)

		// Check if more pages exist
		if !result.Team.Issues.PageInfo.HasNextPage {
			break
		}
		cursor = result.Team.Issues.PageInfo.EndCursor
	}

	return allIssues, nil
}

// GetSubIssues returns all sub-issues of a parent issue (with pagination)
func (c *Client) GetSubIssues(parentID string) ([]Issue, error) {
	var result struct {
		Issue struct {
			Children IssueConnection `json:"children"`
		} `json:"issue"`
	}

	allIssues := make([]Issue, 0)
	cursor := ""

	// Pagination loop
	for {
		variables := map[string]interface{}{
			"issueId": parentID,
		}
		if cursor != "" {
			variables["after"] = cursor
		}

		if err := c.Do(querySubIssues, variables, &result); err != nil {
			return nil, err
		}

		allIssues = append(allIssues, result.Issue.Children.Nodes...)

		// Check if more pages exist
		if !result.Issue.Children.PageInfo.HasNextPage {
			break
		}
		cursor = result.Issue.Children.PageInfo.EndCursor
	}

	return allIssues, nil
}

// GetIssue returns a single issue by ID
func (c *Client) GetIssue(issueID string) (*Issue, error) {
	var result struct {
		Issue Issue `json:"issue"`
	}

	variables := map[string]interface{}{
		"issueId": issueID,
	}

	if err := c.Do(queryIssue, variables, &result); err != nil {
		return nil, err
	}

	return &result.Issue, nil
}

// IsAuthenticated checks if the token is valid by making a test request
func (c *Client) IsAuthenticated() bool {
	_, err := c.GetViewer()
	return err == nil
}
