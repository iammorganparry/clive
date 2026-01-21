package process

import (
	"bufio"
	"bytes"
	"fmt"
	"strings"
)

// FileDiff represents a diff for a single file
type FileDiff struct {
	FilePath     string
	LinesAdded   int
	LinesRemoved int
	LinesChanged int
	Hunks        []DiffHunk
}

// DiffHunk represents a contiguous block of changes
type DiffHunk struct {
	StartLine int
	Lines     []DiffLine
}

// DiffLine represents a single line in a diff
type DiffLine struct {
	LineNumber int    // Line number in the new file (0 if deleted)
	OldLineNum int    // Line number in the old file (0 if added)
	Type       string // "add", "remove", "context"
	Content    string
}

// GenerateFileDiff creates a FileDiff from old and new content
// Uses a simple line-based diff similar to OpenCode's approach
func GenerateFileDiff(filePath, oldContent, newContent string) *FileDiff {
	diff := &FileDiff{
		FilePath: filePath,
		Hunks:    []DiffHunk{},
	}

	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	// Find the changed region using a simple LCS-based approach
	changes := computeLineDiff(oldLines, newLines)

	// Group changes into hunks
	currentHunk := DiffHunk{StartLine: 1, Lines: []DiffLine{}}

	for _, change := range changes {
		switch change.Type {
		case "add":
			diff.LinesAdded++
		case "remove":
			diff.LinesRemoved++
		}
		currentHunk.Lines = append(currentHunk.Lines, change)
	}

	if len(currentHunk.Lines) > 0 {
		diff.Hunks = append(diff.Hunks, currentHunk)
	}

	return diff
}

// computeLineDiff computes a simple line-based diff
func computeLineDiff(oldLines, newLines []string) []DiffLine {
	var result []DiffLine

	// Simple implementation: compare line by line
	// This is a basic Myers diff algorithm simplification
	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	oldIdx := 0
	newIdx := 0

	for oldIdx < len(oldLines) || newIdx < len(newLines) {
		if oldIdx >= len(oldLines) {
			// Remaining lines are additions
			for newIdx < len(newLines) {
				result = append(result, DiffLine{
					LineNumber: newIdx + 1,
					OldLineNum: 0,
					Type:       "add",
					Content:    newLines[newIdx],
				})
				newIdx++
			}
			break
		}

		if newIdx >= len(newLines) {
			// Remaining lines are removals
			for oldIdx < len(oldLines) {
				result = append(result, DiffLine{
					LineNumber: 0,
					OldLineNum: oldIdx + 1,
					Type:       "remove",
					Content:    oldLines[oldIdx],
				})
				oldIdx++
			}
			break
		}

		// Compare current lines
		if oldLines[oldIdx] == newLines[newIdx] {
			// Same line - context
			result = append(result, DiffLine{
				LineNumber: newIdx + 1,
				OldLineNum: oldIdx + 1,
				Type:       "context",
				Content:    newLines[newIdx],
			})
			oldIdx++
			newIdx++
		} else {
			// Different - check if it's a replacement or separate add/remove
			// Look ahead to see if the old line appears later in new
			foundInNew := -1
			for i := newIdx + 1; i < min(newIdx+5, len(newLines)); i++ {
				if oldLines[oldIdx] == newLines[i] {
					foundInNew = i
					break
				}
			}

			// Look ahead to see if the new line appears later in old
			foundInOld := -1
			for i := oldIdx + 1; i < min(oldIdx+5, len(oldLines)); i++ {
				if newLines[newIdx] == oldLines[i] {
					foundInOld = i
					break
				}
			}

			if foundInNew >= 0 && (foundInOld < 0 || foundInNew < foundInOld) {
				// New lines were added before this old line
				for newIdx < foundInNew {
					result = append(result, DiffLine{
						LineNumber: newIdx + 1,
						OldLineNum: 0,
						Type:       "add",
						Content:    newLines[newIdx],
					})
					newIdx++
				}
			} else if foundInOld >= 0 {
				// Old lines were removed before this new line
				for oldIdx < foundInOld {
					result = append(result, DiffLine{
						LineNumber: 0,
						OldLineNum: oldIdx + 1,
						Type:       "remove",
						Content:    oldLines[oldIdx],
					})
					oldIdx++
				}
			} else {
				// Just a simple replacement
				result = append(result, DiffLine{
					LineNumber: 0,
					OldLineNum: oldIdx + 1,
					Type:       "remove",
					Content:    oldLines[oldIdx],
				})
				result = append(result, DiffLine{
					LineNumber: newIdx + 1,
					OldLineNum: 0,
					Type:       "add",
					Content:    newLines[newIdx],
				})
				oldIdx++
				newIdx++
			}
		}
	}

	return result
}

// FormatDiff formats a FileDiff for display in the TUI
func FormatDiff(diff *FileDiff) string {
	var buf bytes.Buffer
	w := bufio.NewWriter(&buf)

	// Header: file path and summary
	fmt.Fprintf(w, "● Update(%s)\n", diff.FilePath)

	// Summary line
	summary := []string{}
	if diff.LinesAdded > 0 {
		summary = append(summary, fmt.Sprintf("Added %d lines", diff.LinesAdded))
	}
	if diff.LinesRemoved > 0 {
		summary = append(summary, fmt.Sprintf("Removed %d lines", diff.LinesRemoved))
	}
	if len(summary) > 0 {
		fmt.Fprintf(w, "  └─ %s\n", strings.Join(summary, ", "))
	}

	// Show hunks (limit to first few lines for brevity)
	maxLines := 10
	lineCount := 0

	for _, hunk := range diff.Hunks {
		for _, line := range hunk.Lines {
			if lineCount >= maxLines {
				remaining := 0
				for _, h := range diff.Hunks {
					remaining += len(h.Lines)
				}
				remaining -= lineCount
				if remaining > 0 {
					fmt.Fprintf(w, "     ... (%d more lines)\n", remaining)
				}
				goto done
			}

			lineCount++

			// Format line number and content
			switch line.Type {
			case "add":
				fmt.Fprintf(w, "     %4d + %s\n", line.LineNumber, line.Content)
			case "remove":
				fmt.Fprintf(w, "     %4d - %s\n", line.OldLineNum, line.Content)
			case "context":
				// Show a few context lines around changes
				if shouldShowContext(line, hunk.Lines) {
					fmt.Fprintf(w, "     %4d   %s\n", line.LineNumber, line.Content)
				}
			}
		}
	}

done:
	w.Flush()
	return buf.String()
}

// shouldShowContext determines if a context line should be shown
// (show context around add/remove lines)
func shouldShowContext(line DiffLine, allLines []DiffLine) bool {
	// Find this line's index
	idx := -1
	for i, l := range allLines {
		if l.LineNumber == line.LineNumber && l.OldLineNum == line.OldLineNum {
			idx = i
			break
		}
	}

	if idx == -1 {
		return false
	}

	// Show if within 1 line of an add/remove
	for i := max(0, idx-1); i <= min(len(allLines)-1, idx+1); i++ {
		if allLines[i].Type != "context" {
			return true
		}
	}

	return false
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
