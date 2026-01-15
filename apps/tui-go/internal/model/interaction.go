package model

// InteractionType represents the type of pending interaction
type InteractionType string

const (
	InteractionTypeQuestion InteractionType = "question"
	InteractionTypeApproval InteractionType = "approval"
)

// PendingInteraction represents a pending question or approval
type PendingInteraction struct {
	Type      InteractionType
	ID        string
	Questions []AgentQuestion // For question type
	ToolName  string          // For approval type
	Args      interface{}     // For approval type
}

// AgentQuestion represents a question from the Claude agent
type AgentQuestion struct {
	Question    string
	Header      string
	Options     []QuestionOption
	MultiSelect bool
}

// QuestionOption represents an option in a question
type QuestionOption struct {
	Label       string
	Description string
}
