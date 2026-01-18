package tracker

import (
	"sync"
	"time"

	"github.com/clive/tui-go/internal/linear"
	"github.com/clive/tui-go/internal/model"
)

// LinearProvider implements Provider for Linear issue tracker
type LinearProvider struct {
	client *linear.Client
	teamID string

	// Cache
	mu        sync.Mutex
	cache     map[string]cachedData
	cacheTTL  time.Duration
	lastFetch time.Time
}

type cachedData struct {
	data      interface{}
	fetchedAt time.Time
}

// NewLinearProvider creates a new Linear provider
func NewLinearProvider(token, teamID string) *LinearProvider {
	return &LinearProvider{
		client:   linear.NewClient(token),
		teamID:   teamID,
		cache:    make(map[string]cachedData),
		cacheTTL: 5 * time.Second, // 5 second cache TTL
	}
}

// Name returns the display name
func (p *LinearProvider) Name() string {
	return "Linear"
}

// IsAvailable checks if Linear is configured and authenticated
func (p *LinearProvider) IsAvailable() bool {
	if p.client == nil || p.teamID == "" {
		return false
	}
	return p.client.IsAuthenticated()
}

// GetEpics returns all parent issues (epics) and assigned issues from Linear
func (p *LinearProvider) GetEpics(filterByUser bool) []model.Session {
	p.mu.Lock()
	defer p.mu.Unlock()

	cacheKey := "epics"
	if cached, ok := p.cache[cacheKey]; ok {
		if time.Since(cached.fetchedAt) < p.cacheTTL {
			if sessions, ok := cached.data.([]model.Session); ok {
				return sessions
			}
		}
	}

	// Merge parent issues (with children) and assigned issues
	issueMap := make(map[string]linear.Issue)

	// Get parent issues (issues with children, no parent)
	parentIssues, err := p.client.GetParentIssues(p.teamID)
	if err == nil {
		for _, issue := range parentIssues {
			if issue.GetChildCount() > 0 {
				issueMap[issue.ID] = issue
			}
		}
	}

	// Get issues assigned to current user (not sub-issues)
	assignedIssues, err := p.client.GetAssignedIssues(p.teamID)
	if err == nil {
		for _, issue := range assignedIssues {
			// Add assigned issues (may override, that's fine - same issue)
			issueMap[issue.ID] = issue
		}
	}

	// Convert map to session slice
	sessions := make([]model.Session, 0, len(issueMap))
	for _, issue := range issueMap {
		sessions = append(sessions, p.issueToSession(issue))
	}

	p.cache[cacheKey] = cachedData{
		data:      sessions,
		fetchedAt: time.Now(),
	}

	return sessions
}

// GetEpicTasks returns all sub-issues (tasks) under a parent issue
func (p *LinearProvider) GetEpicTasks(epicID string) []model.Task {
	p.mu.Lock()
	defer p.mu.Unlock()

	cacheKey := "tasks:" + epicID
	if cached, ok := p.cache[cacheKey]; ok {
		if time.Since(cached.fetchedAt) < p.cacheTTL {
			if tasks, ok := cached.data.([]model.Task); ok {
				return tasks
			}
		}
	}

	issues, err := p.client.GetSubIssues(epicID)
	if err != nil {
		return nil
	}

	tasks := make([]model.Task, 0, len(issues))
	for _, issue := range issues {
		tasks = append(tasks, p.issueToTask(issue))
	}

	p.cache[cacheKey] = cachedData{
		data:      tasks,
		fetchedAt: time.Now(),
	}

	return tasks
}

// ClearCache clears the cache
func (p *LinearProvider) ClearCache() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cache = make(map[string]cachedData)
}

// issueToSession converts a Linear issue to a Session
func (p *LinearProvider) issueToSession(issue linear.Issue) model.Session {
	// Check if any sub-issue is in progress
	isActive := false
	if issue.Children != nil {
		for _, child := range issue.Children.Nodes {
			if child.State.Type == string(linear.StateTypeStarted) {
				isActive = true
				break
			}
		}
	}

	return model.Session{
		ID:       issue.ID,
		Name:     issue.Identifier + " " + issue.Title,
		EpicID:   issue.ID,
		Branch:   extractBranchFromTitle(issue.Title),
		IsActive: isActive,
		// Iteration and MaxIterations not applicable for Linear
		Iteration:     0,
		MaxIterations: 0,
	}
}

// issueToTask converts a Linear issue to a Task
func (p *LinearProvider) issueToTask(issue linear.Issue) model.Task {
	return model.Task{
		ID:       issue.ID,
		Title:    issue.Identifier + " " + issue.Title,
		Status:   mapLinearStateToTaskStatus(issue.State),
		Tier:     mapPriorityToTier(issue.Priority),
		Skill:    extractSkillFromLabels(issue.GetLabels()),
		Category: extractCategoryFromLabels(issue.GetLabels()),
		Target:   "", // Not applicable for Linear
	}
}

// mapLinearStateToTaskStatus maps Linear workflow state to TaskStatus
func mapLinearStateToTaskStatus(state linear.WorkflowState) model.TaskStatus {
	switch linear.StateType(state.Type) {
	case linear.StateTypeBacklog, linear.StateTypeUnstarted:
		return model.TaskStatusPending
	case linear.StateTypeStarted:
		return model.TaskStatusInProgress
	case linear.StateTypeCompleted:
		return model.TaskStatusComplete
	case linear.StateTypeCanceled:
		return model.TaskStatusSkipped
	default:
		return model.TaskStatusPending
	}
}

// mapPriorityToTier maps Linear priority (0-4) to tier (1-5)
// Linear: 0=none, 1=urgent, 2=high, 3=medium, 4=low
// Our tier: 1=highest, 5=lowest
func mapPriorityToTier(priority int) int {
	switch priority {
	case 0:
		return 3 // None → medium
	case 1:
		return 1 // Urgent → tier 1
	case 2:
		return 2 // High → tier 2
	case 3:
		return 3 // Medium → tier 3
	case 4:
		return 4 // Low → tier 4
	default:
		return 3
	}
}

// extractBranchFromTitle tries to extract a branch name from issue title
// This is a heuristic - Linear doesn't have a dedicated branch field
func extractBranchFromTitle(title string) string {
	// For now, just return empty - users can configure this differently
	return ""
}

// extractSkillFromLabels extracts skill from labels (e.g., "skill:backend")
func extractSkillFromLabels(labels []string) string {
	for _, label := range labels {
		if len(label) > 6 && label[:6] == "skill:" {
			return label[6:]
		}
	}
	return ""
}

// extractCategoryFromLabels extracts category from labels (e.g., "category:feature")
func extractCategoryFromLabels(labels []string) string {
	for _, label := range labels {
		if len(label) > 9 && label[:9] == "category:" {
			return label[9:]
		}
	}
	return ""
}
