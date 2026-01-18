package linear

// Issue represents a Linear issue
type Issue struct {
	ID          string         `json:"id"`
	Identifier  string         `json:"identifier"` // e.g., "TEAM-123"
	Title       string         `json:"title"`
	Description string         `json:"description"`
	State       WorkflowState  `json:"state"`
	Parent      *IssueRef      `json:"parent"`
	Children    *IssueNodes    `json:"children"`
	Priority    int            `json:"priority"`
	Labels      *LabelNodes    `json:"labels"`
	Assignee    *User          `json:"assignee"`
	Creator     *User          `json:"creator"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
}

// IssueRef is a minimal issue reference (for parent)
type IssueRef struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
}

// IssueNodes wraps a list of issues (GraphQL connection pattern)
type IssueNodes struct {
	Nodes []Issue `json:"nodes"`
}

// WorkflowState represents a Linear workflow state
type WorkflowState struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Type  string `json:"type"` // "backlog", "unstarted", "started", "completed", "canceled"
	Color string `json:"color"`
}

// Label represents a Linear label
type Label struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// LabelNodes wraps a list of labels (GraphQL connection pattern)
type LabelNodes struct {
	Nodes []Label `json:"nodes"`
}

// User represents a Linear user
type User struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
}

// Team represents a Linear team
type Team struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Key  string `json:"key"` // Short identifier like "TEAM"
}

// TeamNodes wraps a list of teams (GraphQL connection pattern)
type TeamNodes struct {
	Nodes []Team `json:"nodes"`
}

// Viewer represents the current authenticated user
type Viewer struct {
	ID    string    `json:"id"`
	Name  string    `json:"name"`
	Email string    `json:"email"`
	Teams TeamNodes `json:"teams"`
}

// StateType represents Linear workflow state types
type StateType string

const (
	StateTypeBacklog   StateType = "backlog"
	StateTypeUnstarted StateType = "unstarted"
	StateTypeStarted   StateType = "started"
	StateTypeCompleted StateType = "completed"
	StateTypeCanceled  StateType = "canceled"
)

// IsParentIssue returns true if this issue is a parent (has children, no parent)
func (i *Issue) IsParentIssue() bool {
	hasChildren := i.Children != nil && len(i.Children.Nodes) > 0
	hasNoParent := i.Parent == nil
	return hasChildren && hasNoParent
}

// GetChildCount returns the number of sub-issues
func (i *Issue) GetChildCount() int {
	if i.Children == nil {
		return 0
	}
	return len(i.Children.Nodes)
}

// GetLabels returns labels as a string slice
func (i *Issue) GetLabels() []string {
	if i.Labels == nil {
		return nil
	}
	labels := make([]string, len(i.Labels.Nodes))
	for idx, l := range i.Labels.Nodes {
		labels[idx] = l.Name
	}
	return labels
}
