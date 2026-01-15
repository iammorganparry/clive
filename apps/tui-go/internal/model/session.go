package model

// Session represents a beads epic/work session
type Session struct {
	ID            string // beads epic ID
	Name          string // formatted display name
	EpicID        string // beads epic ID (same as ID)
	Branch        string // git branch extracted from title
	IsActive      bool   // has in-progress tasks
	Iteration     int    // build iteration (from state files)
	MaxIterations int    // max iterations for build
}
