package config

// IssueTracker represents the type of issue tracker to use
type IssueTracker string

const (
	TrackerBeads  IssueTracker = "beads"
	TrackerLinear IssueTracker = "linear" // Future
)

// AvailableTrackers returns all available issue trackers
func AvailableTrackers() []TrackerInfo {
	return []TrackerInfo{
		{
			ID:          TrackerBeads,
			Name:        "Beads",
			Description: "Local git-based issue tracking",
			Available:   true,
		},
		{
			ID:          TrackerLinear,
			Name:        "Linear",
			Description: "Cloud-based issue tracking with OAuth",
			Available:   true,
		},
	}
}

// TrackerInfo describes an issue tracker option
type TrackerInfo struct {
	ID          IssueTracker
	Name        string
	Description string
	Available   bool
}
