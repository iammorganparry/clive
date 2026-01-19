package process

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ANSI escape code pattern for stripping all ANSI sequences from output
// Matches: colors (\x1b[...m), cursor movement, clear screen, etc.
var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]`)

// Orphaned ANSI suffixes that appear when escape char was stripped but suffix remains
var orphanedAnsiRegex = regexp.MustCompile(`(?:^|[^0-9])[0-9;]*m(?:[^a-zA-Z]|$)`)

// stripANSI removes ANSI escape codes from a string
func stripANSI(s string) string {
	// First pass: regex for standard sequences
	result := ansiRegex.ReplaceAllString(s, "")

	// Second pass: remove any remaining escape characters and partial sequences
	var clean strings.Builder
	clean.Grow(len(result))
	inEscape := false
	for i := 0; i < len(result); i++ {
		c := result[i]
		if c == 0x1b { // ESC character
			inEscape = true
			continue
		}
		if inEscape {
			// Skip until we hit a letter (end of sequence) or non-sequence char
			if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
				inEscape = false
			} else if c != '[' && c != ';' && !(c >= '0' && c <= '9') {
				// Not part of escape sequence, output it
				inEscape = false
				clean.WriteByte(c)
			}
			continue
		}
		clean.WriteByte(c)
	}

	// Third pass: remove orphaned ANSI suffixes like "0m", "1;34m" at line boundaries
	result = clean.String()
	result = strings.ReplaceAll(result, "0m", "")
	result = strings.ReplaceAll(result, "1m", "")
	result = strings.ReplaceAll(result, "2m", "")
	result = strings.ReplaceAll(result, "22m", "")
	result = strings.ReplaceAll(result, "39m", "")

	return result
}

// Streaming state for accumulating text and tool inputs across chunks
var (
	streamingTextBuffer   strings.Builder    // Accumulates text to detect TASK_COMPLETE across chunks
	currentToolName       string             // Current tool being streamed
	currentToolID         string             // Current tool_use_id for responding to tool calls
	currentToolInput      strings.Builder    // Accumulates tool input JSON
	pendingBdRefresh      bool               // True when a bd command was seen and we need to refresh after execution
	handledQuestionIDs    = make(map[string]bool) // Track all tool_use_ids already emitted via streaming (for dedup)
	streamStateMu         sync.Mutex
)

// ResetStreamingState clears all streaming state buffers
// Must be called at the start of each new build iteration to avoid stale data
func ResetStreamingState() {
	streamStateMu.Lock()
	defer streamStateMu.Unlock()
	streamingTextBuffer.Reset()
	currentToolName = ""
	currentToolID = ""
	currentToolInput.Reset()
	pendingBdRefresh = false
	handledQuestionIDs = make(map[string]bool) // Clear the map
}

// ProcessHandle manages a spawned process
type ProcessHandle struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
	done   chan struct{}
	mu     sync.Mutex
	killed bool
}

// CloseStdin closes the stdin pipe to signal the process to exit
func (p *ProcessHandle) CloseStdin() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stdin != nil {
		p.stdin.Close()
		p.stdin = nil
	}
}

// CloseStdinWithTimeout closes stdin and kills process if it doesn't exit within timeout
func (p *ProcessHandle) CloseStdinWithTimeout(timeout time.Duration) {
	p.CloseStdin()

	// Wait for process to exit with timeout
	select {
	case <-p.done:
		// Process exited cleanly
		return
	case <-time.After(timeout):
		// Timeout - force kill the process
		p.Kill()
	}
}

// OutputLine represents a line of output from the process
type OutputLine struct {
	Text         string
	Type         string // "stdout", "stderr", "tool_call", "tool_result", "assistant", "system", "question", "exit"
	ToolName     string
	RefreshTasks bool // Set true when TodoWrite is called to trigger immediate task refresh
	ExitCode     int  // Exit code when Type is "exit"
	CloseStdin   bool // Set true when TASK_COMPLETE detected - signals Claude to exit
	// Question data for AskUserQuestion tool
	Question *QuestionData
}

// QuestionData represents a question from Claude's AskUserQuestion tool
type QuestionData struct {
	ToolUseID string // The tool_use_id needed for responding
	Header    string
	Question  string
	Options   []QuestionOption
}

// QuestionOption represents a single option in a question
type QuestionOption struct {
	Label       string
	Description string
}

// Kill terminates the process
func (p *ProcessHandle) Kill() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.killed && p.cmd.Process != nil {
		p.killed = true
		p.cmd.Process.Kill()
	}
}

// Interrupt sends SIGINT to the process (like pressing Ctrl+C)
// This allows Claude to gracefully handle the interrupt and continue the conversation
func (p *ProcessHandle) Interrupt() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.killed && p.cmd.Process != nil {
		p.cmd.Process.Signal(syscall.SIGINT)
	}
}

// Wait waits for the process to exit and returns the exit code
func (p *ProcessHandle) Wait() int {
	<-p.done
	if p.cmd.ProcessState == nil {
		return -1
	}
	return p.cmd.ProcessState.ExitCode()
}

// SendMessage sends a message to the process via stdin
func (p *ProcessHandle) SendMessage(message string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stdin == nil {
		return nil
	}

	msg := map[string]interface{}{
		"type": "user",
		"message": map[string]string{
			"role":    "user",
			"content": message,
		},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	_, err = p.stdin.Write(append(data, '\n'))
	return err
}

// SendToolResult sends a tool result response to Claude
// This is used for responding to AskUserQuestion and similar tools
func (p *ProcessHandle) SendToolResult(toolUseID string, result string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stdin == nil {
		return nil
	}

	// Format as tool_result per Claude CLI stream-json spec
	msg := map[string]interface{}{
		"type": "user",
		"message": map[string]interface{}{
			"role": "user",
			"content": []map[string]interface{}{
				{
					"type":        "tool_result",
					"tool_use_id": toolUseID,
					"content":     result,
				},
			},
		},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	_, err = p.stdin.Write(append(data, '\n'))
	return err
}

// findScriptsDir finds the scripts directory
func findScriptsDir() string {
	// Try relative to executable
	execPath, err := os.Executable()
	if err == nil {
		// Go up from bin/clive-tui to tui-go, then to cli/scripts
		scriptsDir := filepath.Join(filepath.Dir(filepath.Dir(execPath)), "..", "cli", "scripts")
		if _, err := os.Stat(scriptsDir); err == nil {
			return scriptsDir
		}
	}

	// Try relative to current working directory
	cwd, err := os.Getwd()
	if err == nil {
		// Look for apps/cli/scripts
		for dir := cwd; dir != "/"; dir = filepath.Dir(dir) {
			scriptsDir := filepath.Join(dir, "apps", "cli", "scripts")
			if _, err := os.Stat(scriptsDir); err == nil {
				return scriptsDir
			}
		}
	}

	// Default fallback
	return "/Users/morganparry/repos/clive/apps/cli/scripts"
}

// RunBuildIteration runs a single build iteration
func RunBuildIteration(iteration, maxIterations int, epicID string, outputChan chan<- OutputLine) *ProcessHandle {
	scriptsDir := findScriptsDir()
	iterationScript := filepath.Join(scriptsDir, "build-iteration.sh")

	args := []string{
		iterationScript,
		"--iteration", strconv.Itoa(iteration),
		"--max-iterations", strconv.Itoa(maxIterations),
		"--streaming",
	}
	if epicID != "" {
		args = append(args, "--epic", epicID)
	}

	return runScript(args, "build", outputChan)
}

// RunPlan runs the plan script
// parentID is optional - if provided, the planning agent will use this existing issue
// as the parent instead of creating a new one
func RunPlan(input string, parentID string, outputChan chan<- OutputLine) *ProcessHandle {
	scriptsDir := findScriptsDir()
	planScript := filepath.Join(scriptsDir, "plan.sh")

	args := []string{planScript, "--streaming"}
	if parentID != "" {
		args = append(args, "--parent", parentID)
	}
	if input != "" {
		args = append(args, input)
	}

	return runScript(args, "plan", outputChan)
}

// runScript runs a bash script and streams output
func runScript(args []string, promptType string, outputChan chan<- OutputLine) *ProcessHandle {
	cmd := exec.Command("bash", args...)
	cmd.Dir, _ = os.Getwd()

	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	handle := &ProcessHandle{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		stderr: stderr,
		done:   make(chan struct{}),
	}

	if err := cmd.Start(); err != nil {
		outputChan <- OutputLine{Text: "Failed to start: " + err.Error(), Type: "system"}
		close(handle.done)
		return handle
	}

	// Send prompt via stdin after spawn (Claude CLI with --input-format stream-json expects this)
	go func() {
		// Determine prompt path file based on type
		var promptPathFile string
		if promptType == "plan" {
			promptPathFile = filepath.Join(".claude", ".plan-prompt-path")
		} else {
			promptPathFile = filepath.Join(".claude", ".build-prompt-path")
		}

		// Delete any stale prompt path file from previous runs
		// This ensures we wait for the fresh file from this run
		os.Remove(promptPathFile)

		// Poll for the prompt path file to exist (build scripts may take time to write it)
		// Build scripts run bd ready which can take 5+ seconds in large repos
		var data []byte
		var err error
		maxWait := 30 * time.Second
		pollInterval := 100 * time.Millisecond
		startTime := time.Now()

		for {
			data, err = os.ReadFile(promptPathFile)
			if err == nil && len(data) > 0 {
				break
			}

			// Check if process was killed or timed out
			handle.mu.Lock()
			killed := handle.killed
			handle.mu.Unlock()
			if killed {
				return
			}

			if time.Since(startTime) > maxWait {
				outputChan <- OutputLine{Text: "Timeout waiting for prompt file\n", Type: "stderr"}
				return
			}

			time.Sleep(pollInterval)
		}

		promptFile := strings.TrimSpace(string(data))
		if promptFile == "" {
			return
		}

		// Poll for the actual prompt file to have content
		var content []byte
		for {
			content, err = os.ReadFile(promptFile)
			if err == nil && len(content) > 0 {
				break
			}

			handle.mu.Lock()
			killed := handle.killed
			handle.mu.Unlock()
			if killed {
				return
			}

			if time.Since(startTime) > maxWait {
				outputChan <- OutputLine{Text: "Timeout waiting for prompt content\n", Type: "stderr"}
				return
			}

			time.Sleep(pollInterval)
		}

		// Send as stream-json message
		msg := map[string]interface{}{
			"type": "user",
			"message": map[string]string{
				"role":    "user",
				"content": "Read and execute all instructions in this prompt:\n\n" + string(content),
			},
		}

		jsonData, err := json.Marshal(msg)
		if err != nil {
			return
		}

		handle.mu.Lock()
		defer handle.mu.Unlock()
		if handle.stdin != nil && !handle.killed {
			handle.stdin.Write(append(jsonData, '\n'))
		}
	}()

	// Use WaitGroup to know when stdout/stderr readers are done
	var wg sync.WaitGroup
	wg.Add(2)

	// Read stdout (NDJSON)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		// Increase buffer for long lines
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			outputs := parseNDJSONLine(line)
			for _, output := range outputs {
				outputChan <- output
			}
		}
	}()

	// Read stderr
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			outputChan <- OutputLine{Text: scanner.Text(), Type: "stderr"}
		}
	}()

	// Wait for process to exit, then send exit message and close channel
	go func() {
		cmd.Wait()
		close(handle.done)

		// Wait for readers to finish
		wg.Wait()

		// Send exit message with actual exit code
		exitCode := 0
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}
		outputChan <- OutputLine{Type: "exit", ExitCode: exitCode}
	}()

	return handle
}

// extractToolDetail extracts a meaningful detail string from tool input
func extractToolDetail(name string, input map[string]interface{}) string {
	if input == nil || len(input) == 0 {
		return ""
	}

	switch name {
	case "Read":
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
	case "Write", "Edit":
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
	case "Bash":
		if cmd, ok := input["command"].(string); ok {
			// Truncate long commands
			if len(cmd) > 60 {
				cmd = cmd[:60] + "..."
			}
			return cmd
		}
		if desc, ok := input["description"].(string); ok {
			return desc
		}
	case "BashRefreshTasks": // Internal marker to check if bash command updates tasks
		if cmd, ok := input["command"].(string); ok {
			// Check if it's a beads command that modifies tasks
			if strings.Contains(cmd, "bd update") || strings.Contains(cmd, "bd close") ||
				strings.Contains(cmd, "bd create") {
				return "true"
			}
		}
		return ""
	case "Grep":
		if pattern, ok := input["pattern"].(string); ok {
			detail := "\"" + pattern + "\""
			if path, ok := input["path"].(string); ok {
				detail += " in " + path
			}
			return detail
		}
	case "Glob":
		if pattern, ok := input["pattern"].(string); ok {
			return pattern
		}
	case "Task":
		if desc, ok := input["description"].(string); ok {
			return desc
		}
	case "TodoWrite":
		return "updating tasks"
	case "WebFetch":
		if url, ok := input["url"].(string); ok {
			return url
		}
	case "WebSearch":
		if query, ok := input["query"].(string); ok {
			return "\"" + query + "\""
		}
	case "AskUserQuestion":
		return "waiting for your response"
	}

	// Fallback: try common field names
	if fp, ok := input["file_path"].(string); ok {
		return fp
	}
	if pattern, ok := input["pattern"].(string); ok {
		return "\"" + pattern + "\""
	}
	if desc, ok := input["description"].(string); ok {
		return desc
	}

	return ""
}

// parseQuestionData extracts question data from AskUserQuestion tool input
func parseQuestionData(input map[string]interface{}) *QuestionData {
	if input == nil {
		return nil
	}

	questions, ok := input["questions"].([]interface{})
	if !ok || len(questions) == 0 {
		return nil
	}

	// For now, just take the first question
	firstQ, ok := questions[0].(map[string]interface{})
	if !ok {
		return nil
	}

	qd := &QuestionData{
		Header:   getString(firstQ, "header"),
		Question: getString(firstQ, "question"),
	}

	// Parse options
	opts, ok := firstQ["options"].([]interface{})
	if ok {
		for _, opt := range opts {
			optMap, ok := opt.(map[string]interface{})
			if !ok {
				continue
			}
			qd.Options = append(qd.Options, QuestionOption{
				Label:       getString(optMap, "label"),
				Description: getString(optMap, "description"),
			})
		}
	}

	return qd
}

// getString safely gets a string value from a map
func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// parseNDJSONLine parses a line of NDJSON from Claude CLI
// Returns a slice of OutputLines since some events contain multiple blocks
func parseNDJSONLine(line string) []OutputLine {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(line), &data); err != nil {
		// Not JSON, return as plain text
		if line != "" {
			return []OutputLine{{Text: line + "\n", Type: "stdout"}}
		}
		return nil
	}

	eventType, _ := data["type"].(string)

	switch eventType {
	case "content_block_delta":
		delta, ok := data["delta"].(map[string]interface{})
		if !ok {
			return nil
		}
		deltaType, _ := delta["type"].(string)
		if deltaType == "text_delta" {
			text, _ := delta["text"].(string)
			if text != "" {
				// Accumulate text to detect completion markers across chunks
				streamStateMu.Lock()
				streamingTextBuffer.WriteString(text)
				accumulated := streamingTextBuffer.String()

				// Check for completion markers in accumulated text
				isComplete := strings.Contains(accumulated, "TASK_COMPLETE") ||
					strings.Contains(accumulated, "ALL_TASKS_COMPLETE") ||
					strings.Contains(accumulated, "PLAN_COMPLETE")

				// Keep buffer small - only need last 50 chars for marker detection
				if streamingTextBuffer.Len() > 100 {
					s := streamingTextBuffer.String()
					streamingTextBuffer.Reset()
					streamingTextBuffer.WriteString(s[len(s)-50:])
				}
				streamStateMu.Unlock()

				return []OutputLine{{
					Text:         stripANSI(text),
					Type:         "assistant",
					RefreshTasks: isComplete,
					CloseStdin:   isComplete,
				}}
			}
		}
		// Handle input_json_delta for tool inputs (accumulate for bd command detection)
		if deltaType == "input_json_delta" {
			partialJSON, _ := delta["partial_json"].(string)
			streamStateMu.Lock()
			currentToolInput.WriteString(partialJSON)
			streamStateMu.Unlock()
			return nil
		}

	case "content_block_start":
		contentBlock, ok := data["content_block"].(map[string]interface{})
		if !ok {
			return nil
		}
		blockType, _ := contentBlock["type"].(string)
		if blockType == "tool_use" {
			name, _ := contentBlock["name"].(string)
			toolID, _ := contentBlock["id"].(string)
			input, _ := contentBlock["input"].(map[string]interface{})

			// Store tool name, ID, and reset input buffer for streaming accumulation
			streamStateMu.Lock()
			currentToolName = name
			currentToolID = toolID
			currentToolInput.Reset()
			streamStateMu.Unlock()
			detail := extractToolDetail(name, input)
			text := "● " + name
			if detail != "" {
				text += " " + detail
			}

			// For AskUserQuestion in streaming mode, defer entirely until content_block_stop
			// when we have the full input JSON. Don't emit a placeholder to avoid duplicates.
			if name == "AskUserQuestion" {
				return nil
			}

			// Check if this tool call should trigger task refresh
			refreshTasks := name == "TodoWrite"
			if name == "Bash" && detail != "" {
				// Check if bash command modifies beads tasks (check detail since input may be empty in streaming)
				if strings.Contains(detail, "bd update") || strings.Contains(detail, "bd close") ||
					strings.Contains(detail, "bd create") {
					refreshTasks = true
				}
			}
			// Check for Linear MCP tools that modify issues
			if name == "mcp__linear__create_issue" || name == "mcp__linear__update_issue" {
				refreshTasks = true
			}

			return []OutputLine{{
				Text:         text + "\n",
				Type:         "tool_call",
				ToolName:     name,
				RefreshTasks: refreshTasks,
			}}
		}
		if blockType == "text" {
			text, _ := contentBlock["text"].(string)
			if text != "" {
				// Check for completion markers in non-streaming text blocks
				isComplete := strings.Contains(text, "TASK_COMPLETE") ||
					strings.Contains(text, "ALL_TASKS_COMPLETE") ||
					strings.Contains(text, "PLAN_COMPLETE")
				return []OutputLine{{
					Text:         stripANSI(text),
					Type:         "assistant",
					RefreshTasks: isComplete,
					CloseStdin:   isComplete,
				}}
			}
		}

	case "content_block_stop":
		// Check accumulated tool input for bd commands when tool block ends
		// Set a flag to refresh after tool execution (not immediately, since command hasn't run yet)
		streamStateMu.Lock()
		toolName := currentToolName
		toolID := currentToolID
		accumulated := currentToolInput.String()
		// Reset state
		currentToolName = ""
		currentToolID = ""
		currentToolInput.Reset()

		if toolName == "Bash" && accumulated != "" {
			if strings.Contains(accumulated, "bd update") ||
				strings.Contains(accumulated, "bd close") ||
				strings.Contains(accumulated, "bd create") {
				pendingBdRefresh = true
			}
		}
		streamStateMu.Unlock()

		// For AskUserQuestion, now we have the full accumulated input - emit the question
		if toolName == "AskUserQuestion" && accumulated != "" {
			var input map[string]interface{}
			if err := json.Unmarshal([]byte(accumulated), &input); err == nil {
				qd := parseQuestionData(input)
				if qd != nil {
					qd.ToolUseID = toolID // Attach the tool_use_id for response
				}
				// Mark this question as handled via streaming (for deduplication with assistant handler)
				streamStateMu.Lock()
				if toolID != "" {
					handledQuestionIDs[toolID] = true
				}
				streamStateMu.Unlock()
				return []OutputLine{{
					Text:     "❓ Awaiting response\n",
					Type:     "question",
					ToolName: toolName,
					Question: qd,
				}}
			}
		}

		return nil

	case "assistant":
		message, ok := data["message"].(map[string]interface{})
		if !ok {
			return nil
		}
		content, ok := message["content"].([]interface{})
		if !ok {
			return nil
		}
		// Return separate OutputLines for each content block
		var results []OutputLine
		for _, c := range content {
			block, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			if block["type"] == "text" {
				text, _ := block["text"].(string)
				if text != "" {
					// Check for completion markers in assistant text
					isComplete := strings.Contains(text, "TASK_COMPLETE") ||
						strings.Contains(text, "ALL_TASKS_COMPLETE") ||
						strings.Contains(text, "PLAN_COMPLETE")
					results = append(results, OutputLine{
						Text:         stripANSI(text),
						Type:         "assistant",
						RefreshTasks: isComplete,
						CloseStdin:   isComplete,
					})
				}
			}
			if block["type"] == "tool_use" {
				name, _ := block["name"].(string)
				input, _ := block["input"].(map[string]interface{})
				detail := extractToolDetail(name, input)
				text := "● " + name
				if detail != "" {
					text += " " + detail
				}

				// Check if this tool call should trigger task refresh
				refreshTasks := name == "TodoWrite"
				if name == "Bash" {
					if cmd, ok := input["command"].(string); ok {
						if strings.Contains(cmd, "bd update") || strings.Contains(cmd, "bd close") ||
							strings.Contains(cmd, "bd create") {
							refreshTasks = true
						}
					}
				}
				// Check for Linear MCP tools that modify issues
				if name == "mcp__linear__create_issue" || name == "mcp__linear__update_issue" {
					refreshTasks = true
				}

				// Handle AskUserQuestion - check if already handled via streaming to avoid duplicates
				if name == "AskUserQuestion" {
					toolID, _ := block["id"].(string)
					// Check if this question was already emitted via streaming (content_block_stop)
					streamStateMu.Lock()
					// Skip if: 1) exact ID match, OR 2) no ID but we've handled questions (likely duplicate)
					alreadyHandled := (toolID != "" && handledQuestionIDs[toolID]) ||
						(toolID == "" && len(handledQuestionIDs) > 0)
					streamStateMu.Unlock()

					if alreadyHandled {
						// Skip - already showed this question via streaming path
						continue
					}

					// Emit the question from assistant message (non-streaming fallback)
					qd := parseQuestionData(input)
					if qd != nil {
						qd.ToolUseID = toolID
					}
					results = append(results, OutputLine{
						Text:     "❓ Awaiting response\n",
						Type:     "question",
						ToolName: name,
						Question: qd,
					})
					continue
				}

				results = append(results, OutputLine{
					Text:         text + "\n",
					Type:         "tool_call",
					ToolName:     name,
					RefreshTasks: refreshTasks,
				})
			}
		}
		return results

	case "result":
		// Tool execution result from Claude CLI
		// Check if we have a pending bd refresh (set when we saw the bd command in tool input)
		streamStateMu.Lock()
		needRefresh := pendingBdRefresh
		pendingBdRefresh = false
		streamStateMu.Unlock()

		if needRefresh {
			return []OutputLine{{Type: "system", RefreshTasks: true}}
		}

		// Also check result content as fallback
		subtype, _ := data["subtype"].(string)
		if subtype == "tool_result" {
			toolName, _ := data["tool_name"].(string)
			if toolName == "Bash" {
				// Check the command or result for bd commands
				result, _ := data["result"].(string)
				command, _ := data["command"].(string)
				checkStr := result + " " + command
				if strings.Contains(checkStr, "bd update") || strings.Contains(checkStr, "bd close") ||
					strings.Contains(checkStr, "bd create") {
					return []OutputLine{{Type: "system", RefreshTasks: true}}
				}
			}
		}

	case "error":
		errData, _ := data["error"].(map[string]interface{})
		if errData != nil {
			msg, _ := errData["message"].(string)
			if msg != "" {
				return []OutputLine{{Text: "Error: " + msg + "\n", Type: "stderr"}}
			}
		}
	}

	return nil
}
