package model

// TaskStatus represents the status of a task
type TaskStatus string

const (
	TaskStatusPending    TaskStatus = "pending"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusComplete   TaskStatus = "complete"
	TaskStatusBlocked    TaskStatus = "blocked"
	TaskStatusSkipped    TaskStatus = "skipped"
)

// Task represents a beads task
type Task struct {
	ID       string     `json:"id"`
	Title    string     `json:"title"`
	Status   TaskStatus `json:"status"`
	Tier     int        `json:"tier"`
	Skill    string     `json:"skill"`
	Category string     `json:"category"`
	Target   string     `json:"target"`
}

// StatusIcon returns the icon for the task status
func (t Task) StatusIcon() string {
	switch t.Status {
	case TaskStatusPending:
		return "○"
	case TaskStatusInProgress:
		return "●"
	case TaskStatusComplete:
		return "✓"
	case TaskStatusBlocked:
		return "⊘"
	case TaskStatusSkipped:
		return "⊖"
	default:
		return "○"
	}
}
