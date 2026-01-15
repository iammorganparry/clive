package process

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

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

// OutputLine represents a line of output from the process
type OutputLine struct {
	Text     string
	Type     string // "stdout", "stderr", "tool_call", "tool_result", "assistant", "system"
	ToolName string
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
func RunPlan(input string, outputChan chan<- OutputLine) *ProcessHandle {
	scriptsDir := findScriptsDir()
	planScript := filepath.Join(scriptsDir, "plan.sh")

	args := []string{planScript, "--streaming"}
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
		time.Sleep(200 * time.Millisecond)

		// Determine prompt path file based on type
		var promptPathFile string
		if promptType == "plan" {
			promptPathFile = filepath.Join(".claude", ".plan-prompt-path")
		} else {
			promptPathFile = filepath.Join(".claude", ".build-prompt-path")
		}

		// Read the path to the actual prompt file
		data, err := os.ReadFile(promptPathFile)
		if err != nil {
			return
		}

		promptFile := strings.TrimSpace(string(data))
		if promptFile == "" {
			return
		}

		// Read the prompt content
		content, err := os.ReadFile(promptFile)
		if err != nil {
			return
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

	// Read stdout (NDJSON)
	go func() {
		scanner := bufio.NewScanner(stdout)
		// Increase buffer for long lines
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			output := parseNDJSONLine(line)
			if output != nil {
				outputChan <- *output
			}
		}
	}()

	// Read stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			outputChan <- OutputLine{Text: scanner.Text(), Type: "stderr"}
		}
	}()

	// Wait for process to exit
	go func() {
		cmd.Wait()
		close(handle.done)
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

// parseNDJSONLine parses a line of NDJSON from Claude CLI
func parseNDJSONLine(line string) *OutputLine {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(line), &data); err != nil {
		// Not JSON, return as plain text
		if line != "" {
			return &OutputLine{Text: line + "\n", Type: "stdout"}
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
				return &OutputLine{Text: text, Type: "assistant"}
			}
		}

	case "content_block_start":
		contentBlock, ok := data["content_block"].(map[string]interface{})
		if !ok {
			return nil
		}
		blockType, _ := contentBlock["type"].(string)
		if blockType == "tool_use" {
			name, _ := contentBlock["name"].(string)
			input, _ := contentBlock["input"].(map[string]interface{})
			detail := extractToolDetail(name, input)
			text := "● " + name
			if detail != "" {
				text += " " + detail
			}
			return &OutputLine{Text: text + "\n", Type: "tool_call", ToolName: name}
		}
		if blockType == "text" {
			text, _ := contentBlock["text"].(string)
			if text != "" {
				return &OutputLine{Text: text, Type: "assistant"}
			}
		}

	case "assistant":
		message, ok := data["message"].(map[string]interface{})
		if !ok {
			return nil
		}
		content, ok := message["content"].([]interface{})
		if !ok {
			return nil
		}
		var result string
		for _, c := range content {
			block, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			if block["type"] == "text" {
				text, _ := block["text"].(string)
				if text != "" {
					result += text
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
				result += text + "\n"
			}
		}
		if result != "" {
			return &OutputLine{Text: result, Type: "assistant"}
		}

	case "error":
		errData, _ := data["error"].(map[string]interface{})
		if errData != nil {
			msg, _ := errData["message"].(string)
			if msg != "" {
				return &OutputLine{Text: "Error: " + msg + "\n", Type: "stderr"}
			}
		}
	}

	return nil
}
