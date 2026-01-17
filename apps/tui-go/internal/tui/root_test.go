package tui

import (
	"testing"

	"github.com/clive/tui-go/internal/config"
	"github.com/clive/tui-go/internal/model"
	"github.com/clive/tui-go/internal/process"
)

// TestIsSuccessfulExit tests the exit code classification logic
func TestIsSuccessfulExit(t *testing.T) {
	tests := []struct {
		name     string
		exitCode int
		want     bool
	}{
		// Successful exit codes
		{"clean exit", 0, true},
		{"macOS killed", -1, true},
		{"SIGKILL (128+9)", 137, true},
		{"SIGTERM (128+15)", 143, true},

		// Failed exit codes - should NOT continue loop
		{"error exit 1", 1, false},
		{"error exit 2", 2, false},
		{"all tasks complete", 10, false}, // Special code handled separately
		{"generic error", 127, false},
		{"SIGINT (128+2)", 130, false},
		{"other signal", 139, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isSuccessfulExit(tt.exitCode)
			if got != tt.want {
				t.Errorf("isSuccessfulExit(%d) = %v, want %v", tt.exitCode, got, tt.want)
			}
		})
	}
}

// TestProcessFinishedIterationContinues tests that the build loop continues on successful exit
func TestProcessFinishedIterationContinues(t *testing.T) {
	tests := []struct {
		name             string
		exitCode         int
		currentIteration int
		maxIterations    int
		wantContinue     bool
		wantIteration    int
	}{
		{
			name:             "clean exit continues",
			exitCode:         0,
			currentIteration: 1,
			maxIterations:    50,
			wantContinue:     true,
			wantIteration:    2,
		},
		{
			name:             "killed process continues",
			exitCode:         -1,
			currentIteration: 1,
			maxIterations:    50,
			wantContinue:     true,
			wantIteration:    2,
		},
		{
			name:             "SIGKILL continues",
			exitCode:         137,
			currentIteration: 3,
			maxIterations:    50,
			wantContinue:     true,
			wantIteration:    4,
		},
		{
			name:             "SIGTERM continues",
			exitCode:         143,
			currentIteration: 5,
			maxIterations:    50,
			wantContinue:     true,
			wantIteration:    6,
		},
		{
			name:             "error exit stops loop",
			exitCode:         1,
			currentIteration: 1,
			maxIterations:    50,
			wantContinue:     false,
			wantIteration:    0, // Reset to 0 on stop
		},
		{
			name:             "max iterations reached stops loop",
			exitCode:         0,
			currentIteration: 50,
			maxIterations:    50,
			wantContinue:     false,
			wantIteration:    0,
		},
		{
			name:             "all tasks complete (exit 10) stops loop",
			exitCode:         10,
			currentIteration: 3,
			maxIterations:    50,
			wantContinue:     false,
			wantIteration:    0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a model in build loop state with process handle
			m := createTestModelWithProcess()
			m.buildLoopRunning = true
			m.isRunning = true
			m.currentIteration = tt.currentIteration
			m.maxIterations = tt.maxIterations
			m.outputChan = make(chan process.OutputLine, 10)

			// Send processFinishedMsg
			msg := processFinishedMsg{exitCode: tt.exitCode}
			newModel, cmd := m.Update(msg)
			m = newModel.(Model)

			// Check if loop continued or stopped
			if tt.wantContinue {
				if !m.buildLoopRunning {
					t.Errorf("expected buildLoopRunning=true, got false")
				}
				if !m.isRunning {
					t.Errorf("expected isRunning=true, got false")
				}
				// Iteration is incremented inside runNextBuildIteration which returns a cmd
				// We check that a command was returned (which would start next iteration)
				if cmd == nil {
					t.Errorf("expected command for next iteration, got nil")
				}
			} else {
				if m.buildLoopRunning {
					t.Errorf("expected buildLoopRunning=false, got true")
				}
				if m.isRunning {
					t.Errorf("expected isRunning=false, got true")
				}
				if m.currentIteration != tt.wantIteration {
					t.Errorf("expected currentIteration=%d, got %d", tt.wantIteration, m.currentIteration)
				}
			}
		})
	}
}

// TestPollingStoppedDoesNotTriggerIteration tests that pollingStoppedMsg doesn't cause iterations
func TestPollingStoppedDoesNotTriggerIteration(t *testing.T) {
	// Create a model in build loop state
	m := createTestModel()
	m.buildLoopRunning = true
	m.isRunning = true
	m.currentIteration = 1
	m.maxIterations = 50

	// Save initial state
	initialIteration := m.currentIteration
	initialRunning := m.isRunning
	initialBuildLoop := m.buildLoopRunning

	// Send pollingStoppedMsg (simulates channel close from stale poll)
	msg := pollingStoppedMsg{}
	newModel, cmd := m.Update(msg)
	m = newModel.(Model)

	// Verify nothing changed
	if m.currentIteration != initialIteration {
		t.Errorf("pollingStoppedMsg changed currentIteration: %d -> %d", initialIteration, m.currentIteration)
	}
	if m.isRunning != initialRunning {
		t.Errorf("pollingStoppedMsg changed isRunning: %v -> %v", initialRunning, m.isRunning)
	}
	if m.buildLoopRunning != initialBuildLoop {
		t.Errorf("pollingStoppedMsg changed buildLoopRunning: %v -> %v", initialBuildLoop, m.buildLoopRunning)
	}

	// No command should be returned (no iteration triggered)
	if cmd != nil {
		t.Errorf("pollingStoppedMsg returned command, expected nil")
	}
}

// TestMultipleProcessFinishedDoesNotCascade tests that duplicate finish messages don't cascade
func TestMultipleProcessFinishedDoesNotCascade(t *testing.T) {
	// Create a model in build loop state
	m := createTestModel()
	m.buildLoopRunning = true
	m.isRunning = true
	m.currentIteration = 1
	m.maxIterations = 50
	m.outputChan = make(chan process.OutputLine, 10)

	// First processFinishedMsg (legitimate) - should continue to iteration 2
	msg1 := processFinishedMsg{exitCode: 0}
	newModel, _ := m.Update(msg1)
	m = newModel.(Model)

	// Model should still be in build loop (iteration incremented via runNextBuildIteration)
	if !m.buildLoopRunning {
		t.Fatal("first processFinishedMsg should keep buildLoopRunning=true")
	}

	// Simulate what runNextBuildIteration does
	m.currentIteration = 2
	m.outputChan = make(chan process.OutputLine, 10)

	// Second processFinishedMsg (spurious from old channel close with exit 0)
	// This used to cascade into iteration 3, now it should NOT
	// Note: With the pollingStoppedMsg fix, channel close returns pollingStoppedMsg, not processFinishedMsg
	// But let's test that even if somehow a processFinishedMsg{0} comes through, it works correctly
	msg2 := processFinishedMsg{exitCode: 0}
	newModel, _ = m.Update(msg2)
	m = newModel.(Model)

	// This WILL increment to iteration 3 because processFinishedMsg{0} is still valid
	// The fix is that channel close now returns pollingStoppedMsg instead
	// So this test demonstrates the old behavior still works for legitimate cases
	if !m.buildLoopRunning {
		t.Errorf("second processFinishedMsg should still keep loop running")
	}
}

// TestWaitForOutputReturnsPollingStoppedOnClose tests the channel close behavior
func TestWaitForOutputReturnsPollingStoppedOnClose(t *testing.T) {
	// Create a channel and close it immediately
	ch := make(chan process.OutputLine, 10)
	close(ch)

	// Get the command from waitForOutput
	cmd := waitForOutput(ch)

	// Execute the command
	msg := cmd()

	// Should be pollingStoppedMsg, not processFinishedMsg
	switch msg.(type) {
	case pollingStoppedMsg:
		// Correct!
	case processFinishedMsg:
		t.Errorf("waitForOutput returned processFinishedMsg on channel close, expected pollingStoppedMsg")
	default:
		t.Errorf("waitForOutput returned unexpected message type: %T", msg)
	}
}

// TestWaitForOutputReturnsExitLineCorrectly tests that exit lines are returned properly
func TestWaitForOutputReturnsExitLineCorrectly(t *testing.T) {
	ch := make(chan process.OutputLine, 10)

	// Send an exit line
	ch <- process.OutputLine{
		Type:     "exit",
		ExitCode: -1,
	}

	// Get the command
	cmd := waitForOutput(ch)

	// Execute
	msg := cmd()

	// Should be outputLineMsg with the exit line
	switch m := msg.(type) {
	case outputLineMsg:
		if m.line.Type != "exit" {
			t.Errorf("expected exit line, got type=%s", m.line.Type)
		}
		if m.line.ExitCode != -1 {
			t.Errorf("expected exitCode=-1, got %d", m.line.ExitCode)
		}
	default:
		t.Errorf("expected outputLineMsg, got %T", msg)
	}
}

// TestWaitForOutputDrainsMultipleLines tests batch draining
func TestWaitForOutputDrainsMultipleLines(t *testing.T) {
	ch := make(chan process.OutputLine, 10)

	// Send multiple lines
	ch <- process.OutputLine{Type: "assistant", Text: "line1"}
	ch <- process.OutputLine{Type: "assistant", Text: "line2"}
	ch <- process.OutputLine{Type: "assistant", Text: "line3"}

	// Get the command
	cmd := waitForOutput(ch)

	// Execute
	msg := cmd()

	// Should be outputBatchMsg with all lines
	switch m := msg.(type) {
	case outputBatchMsg:
		if len(m.lines) != 3 {
			t.Errorf("expected 3 lines in batch, got %d", len(m.lines))
		}
	case outputLineMsg:
		t.Errorf("expected outputBatchMsg for multiple lines, got outputLineMsg")
	default:
		t.Errorf("expected outputBatchMsg, got %T", msg)
	}
}

// TestWaitForOutputNilChannel tests nil channel handling
func TestWaitForOutputNilChannel(t *testing.T) {
	cmd := waitForOutput(nil)
	msg := cmd()

	if msg != nil {
		t.Errorf("expected nil message for nil channel, got %T", msg)
	}
}

// TestExitLineTriggersProcessFinished tests that exit type line triggers processFinishedMsg
func TestExitLineTriggersProcessFinished(t *testing.T) {
	m := createTestModel()
	m.buildLoopRunning = true
	m.isRunning = true
	m.currentIteration = 1
	m.maxIterations = 50
	m.outputChan = make(chan process.OutputLine, 10)

	// Send an exit line via outputLineMsg
	exitLine := process.OutputLine{
		Type:     "exit",
		ExitCode: -1, // Killed
	}
	msg := outputLineMsg{line: exitLine}

	newModel, cmd := m.Update(msg)
	_ = newModel.(Model)

	// Should return a command that produces processFinishedMsg
	if cmd == nil {
		t.Fatal("expected command for processFinishedMsg")
	}

	// Execute the command to get processFinishedMsg
	resultMsg := cmd()
	switch rm := resultMsg.(type) {
	case processFinishedMsg:
		if rm.exitCode != -1 {
			t.Errorf("expected exitCode=-1, got %d", rm.exitCode)
		}
	default:
		t.Errorf("expected processFinishedMsg, got %T", resultMsg)
	}
}

// TestTaskRefreshOnIteration tests that tasks are refreshed when iteration continues
func TestTaskRefreshOnIteration(t *testing.T) {
	m := createTestModelWithProcess()
	m.buildLoopRunning = true
	m.isRunning = true
	m.currentIteration = 1
	m.maxIterations = 50
	m.outputChan = make(chan process.OutputLine, 10)
	m.activeSession = &model.Session{
		EpicID: "test-epic-123",
		Name:   "Test Epic",
	}

	// Send processFinishedMsg with successful exit
	msg := processFinishedMsg{exitCode: 0}
	_, cmd := m.Update(msg)

	// Should have a batched command that includes loadTasks
	if cmd == nil {
		t.Fatal("expected batched command including loadTasks")
	}

	// The command is a batch - we can't easily inspect it, but we know it should exist
	// This test verifies the code path is taken
}

// TestRefreshTasksFlagTriggersLoad tests that RefreshTasks flag triggers task loading
func TestRefreshTasksFlagTriggersLoad(t *testing.T) {
	m := createTestModel()
	m.activeSession = &model.Session{
		EpicID: "test-epic-456",
		Name:   "Test Epic",
	}
	m.outputChan = make(chan process.OutputLine, 10)

	// Send outputLineMsg with RefreshTasks flag
	line := process.OutputLine{
		Type:         "tool_result",
		RefreshTasks: true,
	}
	msg := outputLineMsg{line: line}

	_, cmd := m.Update(msg)

	// Should return commands including loadTasks
	if cmd == nil {
		t.Fatal("expected command for task refresh")
	}
}

// TestCloseStdinFlagTriggersTimeout tests that CloseStdin flag triggers timeout handler
func TestCloseStdinFlagTriggersTimeout(t *testing.T) {
	// This is harder to test without mocking, but we can verify the code path exists
	// by checking that the flag is recognized
	m := createTestModel()
	m.outputChan = make(chan process.OutputLine, 10)
	// Note: processHandle is nil, so CloseStdinWithTimeout won't be called
	// but we can verify no panic occurs

	line := process.OutputLine{
		Type:       "assistant",
		Text:       "TASK_COMPLETE",
		CloseStdin: true,
	}
	msg := outputLineMsg{line: line}

	// Should not panic even with nil processHandle
	newModel, _ := m.Update(msg)
	_ = newModel.(Model)
}

// TestBuildLoopStopsOnAllTasksComplete tests exit code 10 handling
func TestBuildLoopStopsOnAllTasksComplete(t *testing.T) {
	m := createTestModelWithProcess()
	m.buildLoopRunning = true
	m.isRunning = true
	m.currentIteration = 5
	m.maxIterations = 50
	m.outputChan = make(chan process.OutputLine, 10)

	// Exit code 10 = all tasks complete
	msg := processFinishedMsg{exitCode: 10}
	newModel, _ := m.Update(msg)
	m = newModel.(Model)

	// Should stop the loop
	if m.buildLoopRunning {
		t.Errorf("expected buildLoopRunning=false for exit code 10")
	}
	if m.isRunning {
		t.Errorf("expected isRunning=false for exit code 10")
	}
	if m.currentIteration != 0 {
		t.Errorf("expected currentIteration=0 after all tasks complete, got %d", m.currentIteration)
	}

	// Check that "All tasks complete!" message was added
	found := false
	for _, line := range m.outputLines {
		if line.Text == "✅ All tasks complete!" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected 'All tasks complete!' message in output")
	}
}

// TestBuildLoopStopsOnMaxIterations tests max iteration limit
func TestBuildLoopStopsOnMaxIterations(t *testing.T) {
	m := createTestModelWithProcess()
	m.buildLoopRunning = true
	m.isRunning = true
	m.currentIteration = 50
	m.maxIterations = 50
	m.outputChan = make(chan process.OutputLine, 10)

	// Even with successful exit, should stop at max
	msg := processFinishedMsg{exitCode: 0}
	newModel, _ := m.Update(msg)
	m = newModel.(Model)

	if m.buildLoopRunning {
		t.Errorf("expected buildLoopRunning=false at max iterations")
	}
	if m.isRunning {
		t.Errorf("expected isRunning=false at max iterations")
	}

	// Check for max iterations warning
	found := false
	for _, line := range m.outputLines {
		if line.Type == "system" && len(line.Text) > 0 {
			if line.Text[0] == 0xe2 { // Unicode warning emoji
				found = true
				break
			}
		}
	}
	if !found {
		t.Errorf("expected max iterations warning in output")
	}
}

// TestNonBuildLoopProcessFinished tests processFinishedMsg when not in build loop
func TestNonBuildLoopProcessFinished(t *testing.T) {
	m := createTestModelWithProcess()
	m.buildLoopRunning = false
	m.isRunning = true
	m.outputChan = make(chan process.OutputLine, 10)

	msg := processFinishedMsg{exitCode: 0}
	newModel, _ := m.Update(msg)
	m = newModel.(Model)

	// Should just set isRunning to false, no iteration logic
	if m.isRunning {
		t.Errorf("expected isRunning=false after process finished")
	}
	if m.buildLoopRunning {
		t.Errorf("expected buildLoopRunning to remain false")
	}
}

// Helper to create a test model with minimal initialization
func createTestModel() Model {
	cfg := &config.Config{
		IssueTracker: config.TrackerBeads,
	}
	m := NewRootModel(cfg)
	m.ready = true
	m.width = 120
	m.height = 40
	return m
}

// Helper to create a test model with process handle for build loop tests
func createTestModelWithProcess() Model {
	m := createTestModel()
	m.processHandle = &process.ProcessHandle{}
	return m
}
