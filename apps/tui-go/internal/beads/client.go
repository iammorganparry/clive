package beads

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/clive/tui-go/internal/model"
)

// Cache for beads data
var (
	issuesCache    []beadsIssue
	cacheTimestamp time.Time
	cacheTTL       = 2 * time.Second
	cacheMutex     sync.RWMutex

	// Cached git user email (only fetched once)
	gitUserEmail     string
	gitUserEmailOnce sync.Once

	// Cached beads availability check
	beadsAvailable     bool
	beadsAvailableOnce sync.Once
)

// Raw beads issue from JSON output
type beadsIssue struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Status    string   `json:"status"`
	Priority  int      `json:"priority"`
	Labels    []string `json:"labels"`
	Parent    string   `json:"parent,omitempty"`
	Owner     string   `json:"owner,omitempty"`
	CreatedAt string   `json:"created_at,omitempty"`
	UpdatedAt string   `json:"updated_at,omitempty"`
}

// ClearCache clears the beads cache
func ClearCache() {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()
	issuesCache = nil
	cacheTimestamp = time.Time{}
}

// findBeadsRoot searches for .beads directory in current and parent directories
func findBeadsRoot() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}

	for dir := cwd; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		beadsDir := filepath.Join(dir, ".beads")
		if _, err := os.Stat(beadsDir); err == nil {
			return dir
		}
	}

	return ""
}

// IsAvailable checks if beads CLI is available (cached after first call)
func IsAvailable() bool {
	beadsAvailableOnce.Do(func() {
		// Check if bd command exists
		_, err := exec.LookPath("bd")
		if err != nil {
			beadsAvailable = false
			return
		}

		// Check if .beads directory exists in current or parent directories
		beadsAvailable = findBeadsRoot() != ""
	})
	return beadsAvailable
}

// getCachedIssues fetches issues from cache or beads CLI
func getCachedIssues() []beadsIssue {
	cacheMutex.RLock()
	if issuesCache != nil && time.Since(cacheTimestamp) < cacheTTL {
		issues := issuesCache
		cacheMutex.RUnlock()
		return issues
	}
	cacheMutex.RUnlock()

	// Fetch from beads CLI
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	// Double-check after acquiring write lock
	if issuesCache != nil && time.Since(cacheTimestamp) < cacheTTL {
		return issuesCache
	}

	cmd := exec.Command("bd", "list", "--json", "--all")
	// Run from beads root directory
	if beadsRoot := findBeadsRoot(); beadsRoot != "" {
		cmd.Dir = beadsRoot
	}
	output, err := cmd.Output()
	if err != nil {
		issuesCache = []beadsIssue{}
		cacheTimestamp = time.Now()
		return issuesCache
	}

	var issues []beadsIssue
	if err := json.Unmarshal(output, &issues); err != nil {
		issuesCache = []beadsIssue{}
		cacheTimestamp = time.Now()
		return issuesCache
	}

	// Derive parent IDs if not set
	for i := range issues {
		if issues[i].Parent == "" {
			issues[i].Parent = deriveParentID(issues[i].ID)
		}
	}

	issuesCache = issues
	cacheTimestamp = time.Now()
	return issuesCache
}

// deriveParentID derives parent ID from beads ID convention
// "clive-mar.1" → "clive-mar"
// "clive-mar.1.2" → "clive-mar.1"
// "clive-mar" → "" (no parent)
func deriveParentID(id string) string {
	lastDot := strings.LastIndex(id, ".")
	if lastDot == -1 {
		return ""
	}
	return id[:lastDot]
}

// GetGitUserEmail returns the current git user email (cached after first call)
func GetGitUserEmail() string {
	gitUserEmailOnce.Do(func() {
		cmd := exec.Command("git", "config", "user.email")
		output, err := cmd.Output()
		if err != nil {
			gitUserEmail = ""
			return
		}
		gitUserEmail = strings.TrimSpace(string(output))
	})
	return gitUserEmail
}

// GetEpics returns all epics (P0 priority issues)
func GetEpics(filterByCurrentUser bool) []model.Session {
	if !IsAvailable() {
		return nil
	}

	issues := getCachedIssues()

	var currentUserEmail string
	if filterByCurrentUser {
		currentUserEmail = GetGitUserEmail()
	}

	var sessions []model.Session
	for _, issue := range issues {
		// Only P0 priority are epics
		if issue.Priority != 0 {
			continue
		}

		// Filter by current user if requested
		if filterByCurrentUser && currentUserEmail != "" && issue.Owner != currentUserEmail {
			continue
		}

		sessions = append(sessions, model.Session{
			ID:       issue.ID,
			Name:     formatEpicName(issue.Title),
			EpicID:   issue.ID,
			Branch:   extractBranchFromTitle(issue.Title),
			IsActive: hasInProgressTasks(issue.ID),
		})
	}

	return sessions
}

// GetEpicTasks returns all tasks under an epic
func GetEpicTasks(epicID string) []model.Task {
	if !IsAvailable() {
		return nil
	}

	issues := getCachedIssues()

	var tasks []model.Task
	for _, issue := range issues {
		if issue.Parent != epicID {
			continue
		}

		tasks = append(tasks, model.Task{
			ID:     issue.ID,
			Title:  cleanTaskTitle(issue.Title),
			Status: mapBeadsStatus(issue.Status),
			Tier:   extractTier(issue.Priority, issue.Labels),
			Skill:  extractSkill(issue.Labels),
		})
	}

	return tasks
}

// hasInProgressTasks checks if an epic has any in-progress tasks
func hasInProgressTasks(epicID string) bool {
	tasks := GetEpicTasks(epicID)
	for _, t := range tasks {
		if t.Status == model.TaskStatusInProgress {
			return true
		}
	}
	return false
}

// extractBranchFromTitle extracts branch name from epic title
// Pattern: "[feature-auth] Work Plan" -> "feature-auth"
func extractBranchFromTitle(title string) string {
	if len(title) < 2 || title[0] != '[' {
		return ""
	}
	end := strings.Index(title, "]")
	if end == -1 {
		return ""
	}
	return title[1:end]
}

// formatEpicName formats epic title to a human-readable session name
func formatEpicName(title string) string {
	// Check for "[branch] Title" pattern first
	branch := extractBranchFromTitle(title)
	if branch != "" {
		// Convert kebab-case to Title Case
		words := strings.FieldsFunc(branch, func(r rune) bool {
			return r == '-' || r == '_'
		})
		for i, word := range words {
			if len(word) > 0 {
				words[i] = strings.ToUpper(word[:1]) + strings.ToLower(word[1:])
			}
		}
		return strings.Join(words, " ")
	}

	// Clean up common patterns
	name := title

	// Remove date suffix
	if idx := strings.LastIndex(name, " - "); idx != -1 {
		// Check if what follows looks like a date
		suffix := name[idx+3:]
		if len(suffix) >= 10 && suffix[4] == '-' && suffix[7] == '-' {
			name = name[:idx]
		}
	}

	// Remove type prefix
	prefixes := []string{"Task: ", "Epic: ", "Feature: ", "Bug: "}
	for _, prefix := range prefixes {
		if strings.HasPrefix(name, prefix) {
			name = name[len(prefix):]
			break
		}
	}

	name = strings.TrimSpace(name)

	// Truncate if too long
	if len(name) > 30 {
		name = name[:27] + "..."
	}

	if name == "" {
		return title
	}
	return name
}

// cleanTaskTitle cleans up task title
func cleanTaskTitle(title string) string {
	// Remove "Task: " prefix
	if strings.HasPrefix(title, "Task: ") {
		return title[6:]
	}
	return title
}

// mapBeadsStatus maps beads status to model status
func mapBeadsStatus(status string) model.TaskStatus {
	switch status {
	case "open", "pending":
		return model.TaskStatusPending
	case "in_progress":
		return model.TaskStatusInProgress
	case "complete", "closed", "done":
		return model.TaskStatusComplete
	case "blocked":
		return model.TaskStatusBlocked
	default:
		return model.TaskStatusPending
	}
}

// extractTier extracts tier from priority and labels
func extractTier(priority int, labels []string) int {
	// Try to get tier from labels first
	for _, label := range labels {
		if strings.HasPrefix(label, "tier:") {
			tierStr := label[5:]
			if tierStr >= "1" && tierStr <= "9" {
				return int(tierStr[0] - '0')
			}
		}
	}
	// Fall back to priority (0-4 maps to tier 1-5)
	return priority + 1
}

// extractSkill extracts skill from labels
func extractSkill(labels []string) string {
	for _, label := range labels {
		if strings.HasPrefix(label, "skill:") {
			return label[6:]
		}
	}
	return ""
}
