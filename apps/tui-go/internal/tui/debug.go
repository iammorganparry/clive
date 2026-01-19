package tui

import (
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// DebugPanel manages debug output display
type DebugPanel struct {
	enabled bool     // Whether debug panel is enabled
	lines   []string // Recent debug log lines
	buffer  int      // Max lines to keep in buffer
}

// NewDebugPanel creates a new debug panel
func NewDebugPanel(enabled bool) DebugPanel {
	return DebugPanel{
		enabled: enabled,
		buffer:  100, // Keep last 100 debug lines
	}
}

// DebugEventMsg is sent when debug output should be displayed
type DebugEventMsg struct {
	Line string
}

// IsEnabled returns whether debug mode is enabled
func (d *DebugPanel) IsEnabled() bool {
	return d.enabled
}

// AddLine adds a new debug line with timestamp
func (d *DebugPanel) AddLine(line string) {
	if !d.enabled {
		return
	}
	timestamp := time.Now().Format("15:04:05.000")
	d.lines = append(d.lines, timestamp+" "+line)
	// Keep only last N debug lines
	if len(d.lines) > d.buffer {
		d.lines = d.lines[len(d.lines)-d.buffer:]
	}
}

// AddEvent adds a debug event (formats event type prominently)
func (d *DebugPanel) AddEvent(eventType string, details string) {
	if !d.enabled {
		return
	}
	line := "[" + eventType + "]"
	if details != "" {
		line += " " + details
	}
	d.AddLine(line)
}

// Lines returns the current debug lines
func (d *DebugPanel) Lines() []string {
	return d.lines
}

// Render renders the debug panel
func (d *DebugPanel) Render(width, height int) string {
	if !d.enabled {
		return ""
	}

	title := lipgloss.NewStyle().
		Foreground(ColorYellow).
		Bold(true).
		Render("DEBUG")

	// Calculate available height for content (minus title and borders)
	contentHeight := height - 4
	if contentHeight < 1 {
		contentHeight = 1
	}

	// Format debug lines
	var lines []string
	startIdx := 0
	if len(d.lines) > contentHeight {
		startIdx = len(d.lines) - contentHeight
	}
	for i := startIdx; i < len(d.lines); i++ {
		line := d.lines[i]
		// Truncate long lines
		maxLen := width - 4
		if maxLen < 10 {
			maxLen = 10
		}
		if len(line) > maxLen {
			line = line[:maxLen-3] + "..."
		}
		lines = append(lines, line)
	}

	// Pad with empty lines if needed
	for len(lines) < contentHeight {
		lines = append(lines, "")
	}

	content := strings.Join(lines, "\n")

	// Style the panel
	panel := lipgloss.NewStyle().
		Width(width).
		Height(height).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorYellow).
		Padding(0, 1).
		Render(title + "\n" + content)

	return panel
}
