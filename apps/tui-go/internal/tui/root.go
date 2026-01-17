package tui

import (
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/clive/tui-go/internal/config"
	"github.com/clive/tui-go/internal/model"
	"github.com/clive/tui-go/internal/process"
	"github.com/clive/tui-go/internal/tracker"
)

// ViewMode represents the current view
type ViewMode int

const (
	ViewModeSetup     ViewMode = iota // Issue tracker selection (first run)
	ViewModeSelection                 // Epic selection
	ViewModeMain                      // Main dashboard
	ViewModeHelp                      // Help overlay
)

// Messages
type epicsLoadedMsg struct {
	sessions []model.Session
}

type tasksLoadedMsg struct {
	tasks []model.Task
}

type outputLineMsg struct {
	line process.OutputLine
}

type outputBatchMsg struct {
	lines []process.OutputLine
}

type processFinishedMsg struct {
	exitCode int
}

type tickMsg time.Time

type spinnerTickMsg struct{}

// taskAddedMsg is sent when a task has been added via /add command
type taskAddedMsg struct {
	success bool
	output  string
	err     string
}

// pollingStoppedMsg is sent when the output channel closes.
// This is distinct from processFinishedMsg - only explicit "exit" lines should trigger iteration logic.
type pollingStoppedMsg struct{}

// configSavedMsg is sent when the config has been saved
type configSavedMsg struct {
	cfg *config.Config
	err error
}

// Spinner animation frames
var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// Activity phrases (rotated during streaming)
var activityPhrases = []string{
	"Thinking", "Sprouting", "Pondering", "Computing", "Processing",
}

// Model is the root Bubble Tea model
type Model struct {
	// Terminal dimensions
	width  int
	height int

	// View state
	viewMode ViewMode

	// Configuration and issue tracker
	cfg      *config.Config
	provider tracker.Provider
	trackers []config.TrackerInfo // Available trackers for setup
	setupIdx int                  // Selected tracker in setup view

	// Command input
	input          textinput.Model
	inputFocused   bool
	commandHistory []string
	historyIndex   int

	// Data
	sessions      []model.Session
	activeSession *model.Session
	tasks         []model.Task
	selectedIndex int // For epic selection

	// Output
	outputLines  []process.OutputLine
	outputBuffer strings.Builder
	viewport     viewport.Model

	// Process management
	processHandle *process.ProcessHandle
	outputChan    chan process.OutputLine

	// Running state
	isRunning bool

	// Build loop state (Ralph Wiggum loop)
	buildLoopRunning  bool // Whether the build loop is active
	currentIteration  int  // Current iteration number
	maxIterations     int  // Maximum iterations allowed
	defaultMaxIters   int  // Default max iterations (50)

	// Streaming indicator state
	streamStartTime time.Time // When streaming started
	spinnerIndex    int       // Animation frame index

	// Question state (for AskUserQuestion)
	pendingQuestion   *process.QuestionData
	selectedOption    int  // Selected option index
	showQuestionPanel bool // Whether question panel is visible

	// Key bindings
	keys KeyMap

	// Ready state
	ready bool

	// Loading states
	loadingEpics bool
	loadingTasks bool

	// Command suggestions
	showSuggestions    bool
	selectedSuggestion int
}

// Available commands for suggestions
var availableCommands = []struct {
	cmd  string
	desc string
}{
	{"/plan", "Create a work plan"},
	{"/build", "Execute work plan"},
	{"/add", "Add task to epic (build mode)"},
	{"/cancel", "Cancel running process"},
	{"/clear", "Clear output"},
	{"/status", "Show current status"},
	{"/help", "Show help"},
}

// NewRootModel creates a new root model
// If cfg is nil, starts in setup mode to select issue tracker
func NewRootModel(cfg *config.Config) Model {
	// Create text input
	ti := textinput.New()
	ti.Placeholder = "Enter command..."
	ti.Prompt = "❯ "
	ti.PromptStyle = InputPromptStyle
	ti.CharLimit = 0 // No limit
	ti.Width = 80    // Default width, will be updated on WindowSizeMsg

	// Always start with tracker selection screen
	// Pre-select the configured tracker if one exists
	setupIdx := 0
	if cfg != nil {
		for i, t := range config.AvailableTrackers() {
			if t.ID == cfg.IssueTracker {
				setupIdx = i
				break
			}
		}
	}

	return Model{
		viewMode:        ViewModeSetup,
		cfg:             cfg,
		trackers:        config.AvailableTrackers(),
		setupIdx:        setupIdx,
		input:           ti,
		inputFocused:    false,
		keys:            DefaultKeyMap(),
		ready:           false,
		selectedIndex:   0,
		defaultMaxIters: 50, // Default max iterations for build loop
		loadingEpics:    false,
	}
}

// Init initializes the model
func (m Model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		textinput.Blink,
		spinnerTickCmd(), // Animate loading spinner
		tickCmd(),        // Start normal tick for background refresh
	}

	// Only load epics if we have a provider (not in setup mode)
	if m.provider != nil {
		cmds = append(cmds, m.loadEpicsCmd())
	}

	return tea.Batch(cmds...)
}

// loadEpicsCmd loads epics using the provider
func (m Model) loadEpicsCmd() tea.Cmd {
	provider := m.provider
	return func() tea.Msg {
		if provider == nil {
			return epicsLoadedMsg{sessions: nil}
		}
		sessions := provider.GetEpics(false) // Don't filter - show all epics
		return epicsLoadedMsg{sessions: sessions}
	}
}

// loadTasksCmd loads tasks for an epic.
// It clears the cache immediately before fetching to ensure fresh data,
// avoiding race conditions with background tick refreshes.
func (m Model) loadTasksCmd(epicID string) tea.Cmd {
	provider := m.provider
	return func() tea.Msg {
		if provider == nil {
			return tasksLoadedMsg{tasks: nil}
		}
		provider.ClearCache() // Clear cache at fetch time, not enqueue time
		tasks := provider.GetEpicTasks(epicID)
		return tasksLoadedMsg{tasks: tasks}
	}
}

// saveConfigCmd saves the selected issue tracker to config
func (m Model) saveConfigCmd(trackerType config.IssueTracker) tea.Cmd {
	return func() tea.Msg {
		cfg := &config.Config{
			IssueTracker:   trackerType,
			SetupCompleted: true,
		}
		err := config.Save(cfg)
		return configSavedMsg{cfg: cfg, err: err}
	}
}

// tickCmd returns a tick command for polling
func tickCmd() tea.Cmd {
	return tea.Tick(2*time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

// fastTickCmd returns a quick tick for initial load retry
func fastTickCmd() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

// spinnerTickCmd returns a fast tick command for spinner animation
func spinnerTickCmd() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
		return spinnerTickMsg{}
	})
}

// Update handles messages
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true

		// Calculate output area dimensions
		sidebarWidth := 30
		outputWidth := m.width - sidebarWidth - 2
		bodyHeight := m.height - 6 // Account for header, input, status bar
		outputHeight := bodyHeight - 4 // Account for output box borders/padding

		// Update viewport size for fixed-height scrolling
		m.viewport.Width = outputWidth - 6 // Account for borders and padding
		m.viewport.Height = outputHeight
		if m.viewport.Height < 1 {
			m.viewport.Height = 1
		}

		// Update input width (account for border, padding, and prompt)
		inputWidth := m.width - 8 // 4 for border/padding, 4 for prompt "❯ "
		if inputWidth < 10 {
			inputWidth = 10
		}
		m.input.Width = inputWidth

		// Re-render content if we have output
		if len(m.outputLines) > 0 {
			m.viewport.SetContent(m.renderOutputContent())
			m.viewport.GotoBottom()
		}

	case epicsLoadedMsg:
		m.sessions = msg.sessions
		m.loadingEpics = false

	case tasksLoadedMsg:
		m.tasks = msg.tasks
		m.loadingTasks = false

	case configSavedMsg:
		if msg.err != nil {
			// Show error (could add error state to Model for better UX)
			return m, nil
		}
		// Config saved successfully - create provider and go to selection
		m.cfg = msg.cfg
		m.provider, _ = tracker.NewProvider(msg.cfg.IssueTracker)
		m.viewMode = ViewModeSelection
		m.loadingEpics = true
		return m, m.loadEpicsCmd()

	case outputLineMsg:
		// Handle exit message type - process has finished
		if msg.line.Type == "exit" {
			return m, func() tea.Msg {
				return processFinishedMsg{exitCode: msg.line.ExitCode}
			}
		}

		m.outputLines = append(m.outputLines, msg.line)
		// Keep only last 500 lines
		if len(m.outputLines) > 500 {
			m.outputLines = m.outputLines[len(m.outputLines)-500:]
		}
		// Update viewport content
		m.viewport.SetContent(m.renderOutputContent())
		m.viewport.GotoBottom()

		// Handle RefreshTasks flag - immediately refresh task sidebar
		if msg.line.RefreshTasks {
			if m.activeSession != nil {
				cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
			}
		}

		// Handle CloseStdin flag - signal Claude to exit after TASK_COMPLETE
		if msg.line.CloseStdin && m.processHandle != nil {
			go m.processHandle.CloseStdinWithTimeout(3 * time.Second)
		}

		// Handle question type - show question panel
		if msg.line.Type == "question" && msg.line.Question != nil {
			m.pendingQuestion = msg.line.Question
			m.showQuestionPanel = true
			m.selectedOption = 0
			m.inputFocused = true
			m.input.Focus()
			m.input.SetValue("")
		}

		// Continue polling for more output
		if m.outputChan != nil {
			cmds = append(cmds, m.pollOutput())
		}

	case outputBatchMsg:
		// Check for exit message in batch and extract exit code
		var exitMsg *process.OutputLine
		var regularLines []process.OutputLine
		for i := range msg.lines {
			if msg.lines[i].Type == "exit" {
				exitMsg = &msg.lines[i]
			} else {
				regularLines = append(regularLines, msg.lines[i])
			}
		}

		// Add non-exit lines to output
		m.outputLines = append(m.outputLines, regularLines...)
		// Keep only last 500 lines
		if len(m.outputLines) > 500 {
			m.outputLines = m.outputLines[len(m.outputLines)-500:]
		}
		// Update viewport content
		m.viewport.SetContent(m.renderOutputContent())
		m.viewport.GotoBottom()

		// Check batch for RefreshTasks, CloseStdin, and questions
		for _, line := range regularLines {
			if line.RefreshTasks {
				if m.activeSession != nil {
					cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
				}
			}
			if line.CloseStdin && m.processHandle != nil {
				go m.processHandle.CloseStdinWithTimeout(3 * time.Second)
			}
		}

		// Handle question type - show question panel (check last question in batch)
		for i := len(regularLines) - 1; i >= 0; i-- {
			line := regularLines[i]
			if line.Type == "question" && line.Question != nil {
				m.pendingQuestion = line.Question
				m.showQuestionPanel = true
				m.selectedOption = 0
				m.inputFocused = true
				m.input.Focus()
				m.input.SetValue("")
				break
			}
		}

		// If we found an exit message, trigger process finished
		if exitMsg != nil {
			return m, func() tea.Msg {
				return processFinishedMsg{exitCode: exitMsg.ExitCode}
			}
		}

		// Continue polling for more output
		if m.outputChan != nil {
			cmds = append(cmds, m.pollOutput())
		}

	case processFinishedMsg:
		exitCode := msg.exitCode

		// Guard: ignore if we already processed this (no active process)
		if m.processHandle == nil {
			return m, tea.Batch(cmds...)
		}

		m.processHandle = nil
		if m.outputChan != nil {
			close(m.outputChan)
			m.outputChan = nil
		}

		// Handle build loop continuation
		if m.buildLoopRunning {
			// Exit code 10 = all tasks complete
			if exitCode == 10 {
				m.outputLines = append(m.outputLines, process.OutputLine{
					Text: "✅ All tasks complete!",
					Type: "system",
				})
				m.buildLoopRunning = false
				m.currentIteration = 0
				m.isRunning = false
			} else if isSuccessfulExit(exitCode) && m.currentIteration < m.maxIterations {
				// Task complete, continue to next iteration
				m.outputLines = append(m.outputLines, process.OutputLine{
					Text: "",
					Type: "system",
				})
				m.outputLines = append(m.outputLines, process.OutputLine{
					Text: "--- Iteration complete ---",
					Type: "system",
				})

				// Update viewport before starting next iteration
				m.viewport.SetContent(m.renderOutputContent())
				m.viewport.GotoBottom()

				// Refresh tasks before next iteration
				if m.activeSession != nil {
					cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
				}

				// Start next iteration
				cmds = append(cmds, m.runNextBuildIteration())
			} else if m.currentIteration >= m.maxIterations {
				// Max iterations reached
				m.outputLines = append(m.outputLines, process.OutputLine{
					Text: fmt.Sprintf("⚠️ Max iterations (%d) reached", m.maxIterations),
					Type: "system",
				})
				m.buildLoopRunning = false
				m.currentIteration = 0
				m.isRunning = false
			} else {
				// Error or cancelled
				m.buildLoopRunning = false
				m.currentIteration = 0
				m.isRunning = false
			}
		} else {
			m.isRunning = false
		}

		// Refresh tasks after process finishes
		if m.activeSession != nil {
			cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
		}

	case spinnerTickMsg:
		// Advance spinner animation when running or loading
		if m.isRunning || m.loadingEpics || m.loadingTasks {
			m.spinnerIndex = (m.spinnerIndex + 1) % len(spinnerFrames)
			cmds = append(cmds, spinnerTickCmd())
		}

	case taskAddedMsg:
		if msg.success {
			m.outputLines = append(m.outputLines, process.OutputLine{
				Text: "✓ Task added",
				Type: "system",
			})
			// Refresh task list
			if m.activeSession != nil {
				cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
			}
		} else {
			m.outputLines = append(m.outputLines, process.OutputLine{
				Text: "Failed to add task: " + msg.err,
				Type: "stderr",
			})
		}

	case pollingStoppedMsg:
		// Channel closed - this is benign, just stop polling.
		// The actual exit code comes from the "exit" type line, not channel close.
		// This prevents duplicate processFinishedMsg when multiple polls are in flight.

	case tickMsg:
		// Use fast tick while loading, normal tick once loaded
		if m.viewMode == ViewModeSelection && len(m.sessions) == 0 {
			cmds = append(cmds, fastTickCmd())
			cmds = append(cmds, m.loadEpicsCmd())
		} else {
			cmds = append(cmds, tickCmd())
		}
		// Check for output from process
		if m.outputChan != nil {
			cmds = append(cmds, m.pollOutput())
		}
		// Refresh tasks if in main view
		if m.activeSession != nil {
			cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
		}

	case tea.KeyMsg:
		// Ctrl+C always quits, regardless of state
		if msg.Type == tea.KeyCtrlC {
			return m, tea.Quit
		}

		// Handle input when focused
		if m.inputFocused {
			// Handle question panel navigation
			if m.showQuestionPanel && m.pendingQuestion != nil {
				totalOptions := len(m.pendingQuestion.Options) + 1 // +1 for "Other"

				switch msg.Type {
				case tea.KeyUp:
					if m.selectedOption > 0 {
						m.selectedOption--
					}
					return m, tea.Batch(cmds...)
				case tea.KeyDown:
					if m.selectedOption < totalOptions-1 {
						m.selectedOption++
					}
					return m, tea.Batch(cmds...)
				case tea.KeyEnter:
					// If "Other" is selected and input is empty, just focus input
					if m.selectedOption == len(m.pendingQuestion.Options) {
						inputVal := m.input.Value()
						if inputVal == "" {
							// Just let user type in the input
							break
						}
						// Send custom input
						m.sendQuestionResponse(inputVal)
					} else {
						// Send selected option
						opt := m.pendingQuestion.Options[m.selectedOption]
						m.sendQuestionResponse(opt.Label)
					}
					m.showQuestionPanel = false
					m.pendingQuestion = nil
					m.selectedOption = 0
					m.input.SetValue("")
					return m, tea.Batch(cmds...)
				case tea.KeyEsc:
					m.showQuestionPanel = false
					m.pendingQuestion = nil
					m.selectedOption = 0
					m.inputFocused = false
					m.input.Blur()
					return m, tea.Batch(cmds...)
				default:
					// Allow typing for "Other" option
					if m.selectedOption == len(m.pendingQuestion.Options) {
						var cmd tea.Cmd
						m.input, cmd = m.input.Update(msg)
						cmds = append(cmds, cmd)
						return m, tea.Batch(cmds...)
					}
				}
			}

			// Update suggestions visibility based on input
			inputVal := m.input.Value()
			m.showSuggestions = strings.HasPrefix(inputVal, "/") && !strings.Contains(inputVal, " ")

			// Get filtered suggestions
			filteredSuggestions := m.getFilteredSuggestions()

			switch msg.Type {
			case tea.KeyEnter:
				// If suggestions are shown and one is selected, use it
				if m.showSuggestions && len(filteredSuggestions) > 0 {
					m.input.SetValue(filteredSuggestions[m.selectedSuggestion].cmd + " ")
					m.input.CursorEnd()
					m.showSuggestions = false
					m.selectedSuggestion = 0
					return m, tea.Batch(cmds...)
				}
				// Otherwise execute the command
				cmdStr := m.input.Value()
				if cmdStr != "" {
					m.commandHistory = append(m.commandHistory, cmdStr)
					m.historyIndex = len(m.commandHistory)
					execCmd := m.executeCommand(cmdStr)
					if execCmd != nil {
						cmds = append(cmds, execCmd)
					}
					m.input.SetValue("")
				}
				m.showSuggestions = false
				m.selectedSuggestion = 0
				return m, tea.Batch(cmds...)
			case tea.KeyTab:
				// Tab completes the selected suggestion
				if m.showSuggestions && len(filteredSuggestions) > 0 {
					m.input.SetValue(filteredSuggestions[m.selectedSuggestion].cmd + " ")
					m.input.CursorEnd()
					m.showSuggestions = false
					m.selectedSuggestion = 0
				}
				return m, tea.Batch(cmds...)
			case tea.KeyEsc:
				if m.showSuggestions {
					m.showSuggestions = false
					m.selectedSuggestion = 0
				} else {
					m.inputFocused = false
					m.input.Blur()
				}
				return m, tea.Batch(cmds...)
			case tea.KeyUp:
				// Navigate suggestions if shown
				if m.showSuggestions && len(filteredSuggestions) > 0 {
					if m.selectedSuggestion > 0 {
						m.selectedSuggestion--
					}
					return m, tea.Batch(cmds...)
				}
				// Use history navigation if input is empty
				if m.input.Value() == "" && len(m.commandHistory) > 0 {
					if m.historyIndex > 0 {
						m.historyIndex--
						m.input.SetValue(m.commandHistory[m.historyIndex])
						m.input.CursorEnd()
					}
					return m, tea.Batch(cmds...)
				}
				// Otherwise pass to textinput
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				cmds = append(cmds, cmd)
				return m, tea.Batch(cmds...)
			case tea.KeyDown:
				// Navigate suggestions if shown
				if m.showSuggestions && len(filteredSuggestions) > 0 {
					if m.selectedSuggestion < len(filteredSuggestions)-1 {
						m.selectedSuggestion++
					}
					return m, tea.Batch(cmds...)
				}
				// Use history navigation if input is empty
				if m.input.Value() == "" && len(m.commandHistory) > 0 {
					if m.historyIndex < len(m.commandHistory)-1 {
						m.historyIndex++
						m.input.SetValue(m.commandHistory[m.historyIndex])
						m.input.CursorEnd()
					} else if m.historyIndex == len(m.commandHistory)-1 {
						m.historyIndex = len(m.commandHistory)
						m.input.SetValue("")
					}
					return m, tea.Batch(cmds...)
				}
				// Otherwise pass to textinput
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				cmds = append(cmds, cmd)
				return m, tea.Batch(cmds...)
			case tea.KeyCtrlA:
				// Select all text (Ctrl+A / Cmd+A)
				m.input.CursorStart()
				m.input.SetCursor(len(m.input.Value()))
				// Use shift+home style selection by setting cursor at end after starting at beginning
				// This triggers the built-in selection in textinput
				m.input.CursorStart()
				// Select to end
				val := m.input.Value()
				for range val {
					m.input.SetCursor(m.input.Position() + 1)
				}
				return m, tea.Batch(cmds...)
			default:
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				cmds = append(cmds, cmd)
				// Update suggestions after input change
				newVal := m.input.Value()
				m.showSuggestions = strings.HasPrefix(newVal, "/") && !strings.Contains(newVal, " ")
				if m.showSuggestions {
					m.selectedSuggestion = 0 // Reset selection on new input
				}
				return m, tea.Batch(cmds...)
			}
		}

		// Handle setup screen (issue tracker selection)
		if m.viewMode == ViewModeSetup {
			switch {
			case key.Matches(msg, m.keys.Quit):
				return m, tea.Quit
			case key.Matches(msg, m.keys.Up):
				if m.setupIdx > 0 {
					m.setupIdx--
				}
			case key.Matches(msg, m.keys.Down):
				if m.setupIdx < len(m.trackers)-1 {
					m.setupIdx++
				}
			case key.Matches(msg, m.keys.Enter):
				// Select tracker if available
				if m.setupIdx < len(m.trackers) && m.trackers[m.setupIdx].Available {
					selectedTracker := m.trackers[m.setupIdx].ID
					return m, m.saveConfigCmd(selectedTracker)
				}
			}
			return m, tea.Batch(cmds...)
		}

		// Handle selection screen
		if m.viewMode == ViewModeSelection {
			switch {
			case key.Matches(msg, m.keys.Quit):
				return m, tea.Quit
			case key.Matches(msg, m.keys.Up):
				if m.selectedIndex > 0 {
					m.selectedIndex--
				}
			case key.Matches(msg, m.keys.Down):
				if m.selectedIndex < len(m.sessions)-1 {
					m.selectedIndex++
				}
			case key.Matches(msg, m.keys.Enter):
				if len(m.sessions) > 0 && m.selectedIndex < len(m.sessions) {
					m.activeSession = &m.sessions[m.selectedIndex]
					m.viewMode = ViewModeMain
					// Clear input when entering main view
					m.input.SetValue("")
					m.input.Blur()
					m.inputFocused = false
					// Load tasks for selected epic
					cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
				}
			case msg.String() == "n":
				// New session - go to main view
				m.viewMode = ViewModeMain
				m.inputFocused = true
				m.input.Focus()
				m.input.SetValue("/plan ")
				m.input.CursorEnd()
			}
			return m, tea.Batch(cmds...)
		}

		// Handle main view
		switch {
		case key.Matches(msg, m.keys.Quit):
			return m, tea.Quit

		case key.Matches(msg, m.keys.Help):
			if m.viewMode == ViewModeHelp {
				m.viewMode = ViewModeMain
			} else {
				m.viewMode = ViewModeHelp
			}
			return m, tea.Batch(cmds...)

		case key.Matches(msg, m.keys.Escape):
			if m.viewMode == ViewModeHelp {
				m.viewMode = ViewModeMain
			} else if len(m.sessions) > 0 {
				m.viewMode = ViewModeSelection
			}
			return m, tea.Batch(cmds...)

		case key.Matches(msg, m.keys.Focus):
			// "/" focuses input and pre-fills "/"
			m.inputFocused = true
			m.input.Focus()
			m.input.SetValue("/")
			m.input.CursorEnd()
			cmds = append(cmds, textinput.Blink)
			return m, tea.Batch(cmds...)

		case msg.String() == "i":
			// "i" focuses input without pre-fill (clear any existing content)
			m.inputFocused = true
			m.input.Focus()
			m.input.SetValue("")
			cmds = append(cmds, textinput.Blink)
			return m, tea.Batch(cmds...)

		case msg.String() == ":":
			// ":" focuses input and pre-fills ":"
			m.inputFocused = true
			m.input.Focus()
			m.input.SetValue(":")
			m.input.CursorEnd()
			cmds = append(cmds, textinput.Blink)
			return m, tea.Batch(cmds...)

		case key.Matches(msg, m.keys.Build):
			if !m.isRunning {
				execCmd := m.startBuild()
				if execCmd != nil {
					cmds = append(cmds, execCmd)
				}
			}
			return m, tea.Batch(cmds...)

		case key.Matches(msg, m.keys.Cancel):
			if m.isRunning && m.processHandle != nil {
				m.processHandle.Kill()
				m.isRunning = false
				m.buildLoopRunning = false
				m.currentIteration = 0
				m.outputLines = append(m.outputLines, process.OutputLine{
					Text: "Build cancelled",
					Type: "system",
				})
			}
			return m, tea.Batch(cmds...)

		case key.Matches(msg, m.keys.Refresh):
			// Refresh epics and tasks
			cmds = append(cmds, m.loadEpicsCmd())
			if m.activeSession != nil {
				cmds = append(cmds, m.loadTasksCmd(m.activeSession.EpicID))
			}
			return m, tea.Batch(cmds...)

		default:
			// Ignore all other keys when input is not focused
			return m, tea.Batch(cmds...)
		}
	}

	return m, tea.Batch(cmds...)
}

// View renders the UI
func (m Model) View() string {
	// Setup and selection views can render before window size is known
	if m.viewMode == ViewModeSetup {
		return m.setupView()
	}

	if m.viewMode == ViewModeSelection {
		return m.selectionView()
	}

	// Other views need terminal dimensions
	if !m.ready {
		return "Loading..."
	}

	switch m.viewMode {
	case ViewModeHelp:
		return m.helpView()
	default:
		return m.mainView()
	}
}

// mainView renders the main dashboard
func (m Model) mainView() string {
	// Header
	header := m.renderHeader()

	// Calculate body dimensions
	// Account for: header (2 lines), input (3 lines), status bar (1 line)
	bodyHeight := m.height - 6

	// Sidebar (30 chars wide)
	sidebarWidth := 30
	sidebar := m.renderSidebar(sidebarWidth, bodyHeight)

	// Output area (remaining width)
	outputWidth := m.width - sidebarWidth - 2
	output := m.renderOutput(outputWidth, bodyHeight)

	// Combine sidebar and output
	body := lipgloss.JoinHorizontal(lipgloss.Top, sidebar, output)

	// Command input
	input := m.renderInput()

	// Status bar
	statusBar := m.renderStatusBar()

	return lipgloss.JoinVertical(lipgloss.Left,
		header,
		body,
		input,
		statusBar,
	)
}

// renderHeader renders the header bar
func (m Model) renderHeader() string {
	// CLIVE title in red/bold
	title := lipgloss.NewStyle().
		Foreground(ColorRed).
		Bold(true).
		Render("CLIVE")

	// Subtitle
	subtitle := lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("AI-Powered Work Execution")

	// Session name if active
	var sessionInfo string
	if m.activeSession != nil {
		sessionInfo = lipgloss.NewStyle().
			Foreground(ColorFgSecondary).
			Render(" · " + m.activeSession.Name)
	}

	// Build the header line
	headerLine := title + "  " + subtitle + sessionInfo

	// Return header with explicit newline to ensure it takes space
	return lipgloss.NewStyle().
		PaddingLeft(1).
		Width(m.width).
		Render(headerLine) + "\n"
}

// renderInput renders the command input with suggestions
func (m Model) renderInput() string {
	var result strings.Builder

	// Render question panel if active (takes priority over suggestions)
	if m.showQuestionPanel && m.pendingQuestion != nil {
		result.WriteString(m.renderQuestionPanel())
		result.WriteString("\n")
	}

	// Render suggestions panel if active (but not when question panel is shown)
	if m.showSuggestions && m.inputFocused && !m.showQuestionPanel {
		suggestions := m.getFilteredSuggestions()
		if len(suggestions) > 0 {
			var suggestionsContent strings.Builder
			for i, s := range suggestions {
				var itemStyle lipgloss.Style
				if i == m.selectedSuggestion {
					itemStyle = lipgloss.NewStyle().
						Background(ColorBgHighlight).
						Foreground(ColorFgPrimary).
						Bold(true).
						Padding(0, 1)
				} else {
					itemStyle = lipgloss.NewStyle().
						Foreground(ColorFgPrimary).
						Padding(0, 1)
				}
				descStyle := lipgloss.NewStyle().
					Foreground(ColorFgMuted)

				suggestionsContent.WriteString(itemStyle.Render(s.cmd))
				suggestionsContent.WriteString(descStyle.Render(" - " + s.desc))
				suggestionsContent.WriteString("\n")
			}

			suggestionsBox := lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(ColorBorder).
				Padding(0, 1).
				Width(m.width - 4).
				Render(strings.TrimSuffix(suggestionsContent.String(), "\n"))

			result.WriteString(suggestionsBox)
			result.WriteString("\n")
		}
	}

	// Render input box
	var style lipgloss.Style
	if m.inputFocused {
		style = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorGreen).
			Padding(0, 1).
			Width(m.width - 4)
	} else {
		style = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorBorder).
			Padding(0, 1).
			Width(m.width - 4)
	}

	result.WriteString(style.Render(m.input.View()))
	return result.String()
}

// renderSidebar renders the task sidebar
func (m Model) renderSidebar(width, height int) string {
	title := SidebarTitleStyle.Render("TASKS")

	// Group tasks by status
	var pending, inProgress, complete []model.Task
	for _, t := range m.tasks {
		switch t.Status {
		case model.TaskStatusPending:
			pending = append(pending, t)
		case model.TaskStatusInProgress:
			inProgress = append(inProgress, t)
		case model.TaskStatusComplete:
			complete = append(complete, t)
		}
	}

	content := title + "\n\n"
	maxDisplay := 10 // Max tasks to show per category

	if len(inProgress) > 0 {
		content += TaskInProgressStyle.Render("In Progress") + "\n"
		displayCount := min(len(inProgress), maxDisplay)
		for _, t := range inProgress[:displayCount] {
			content += TaskInProgressStyle.Render("  ● "+truncate(t.Title, width-6)) + "\n"
		}
		if len(inProgress) > maxDisplay {
			content += TaskInProgressStyle.Render(fmt.Sprintf("  + %d more", len(inProgress)-maxDisplay)) + "\n"
		}
		content += "\n"
	}

	if len(pending) > 0 {
		content += TaskPendingStyle.Render("Pending") + "\n"
		displayCount := min(len(pending), maxDisplay)
		for _, t := range pending[:displayCount] {
			content += TaskPendingStyle.Render("  ○ "+truncate(t.Title, width-6)) + "\n"
		}
		if len(pending) > maxDisplay {
			content += TaskPendingStyle.Render(fmt.Sprintf("  + %d more", len(pending)-maxDisplay)) + "\n"
		}
		content += "\n"
	}

	if len(complete) > 0 {
		content += TaskCompleteStyle.Render("Complete") + "\n"
		displayCount := min(len(complete), maxDisplay)
		for _, t := range complete[:displayCount] {
			content += TaskCompleteStyle.Render("  ✓ "+truncate(t.Title, width-6)) + "\n"
		}
		if len(complete) > maxDisplay {
			content += TaskCompleteStyle.Render(fmt.Sprintf("  + %d more", len(complete)-maxDisplay)) + "\n"
		}
	}

	if len(m.tasks) == 0 {
		content += lipgloss.NewStyle().
			Foreground(ColorFgMuted).
			Render("No tasks yet.\nRun /plan to create.")
	}

	return SidebarStyle.
		Width(width).
		Height(height).
		Render(content)
}

// renderQuestionPanel renders the question panel for AskUserQuestion
func (m Model) renderQuestionPanel() string {
	if !m.showQuestionPanel || m.pendingQuestion == nil {
		return ""
	}

	q := m.pendingQuestion
	var content strings.Builder

	// Header
	header := lipgloss.NewStyle().
		Foreground(ColorBlue).
		Bold(true).
		Render("❓ " + q.Header)
	content.WriteString(header)
	content.WriteString("\n\n")

	// Question text
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgPrimary).
		Render(q.Question))
	content.WriteString("\n\n")

	// Options
	for i, opt := range q.Options {
		var optStyle lipgloss.Style
		prefix := "  "
		if i == m.selectedOption {
			optStyle = lipgloss.NewStyle().
				Background(ColorBgHighlight).
				Foreground(ColorFgPrimary).
				Bold(true).
				Padding(0, 1)
			prefix = "▸ "
		} else {
			optStyle = lipgloss.NewStyle().
				Foreground(ColorFgPrimary).
				Padding(0, 1)
			prefix = "  "
		}

		optLine := optStyle.Render(prefix + opt.Label)
		if opt.Description != "" {
			optLine += lipgloss.NewStyle().
				Foreground(ColorFgMuted).
				Render(" - " + opt.Description)
		}
		content.WriteString(optLine)
		content.WriteString("\n")
	}

	// Add "Other" option
	otherIdx := len(q.Options)
	var otherStyle lipgloss.Style
	prefix := "  "
	if m.selectedOption == otherIdx {
		otherStyle = lipgloss.NewStyle().
			Background(ColorBgHighlight).
			Foreground(ColorFgPrimary).
			Bold(true).
			Padding(0, 1)
		prefix = "▸ "
	} else {
		otherStyle = lipgloss.NewStyle().
			Foreground(ColorFgPrimary).
			Padding(0, 1)
	}
	content.WriteString(otherStyle.Render(prefix + "Other"))
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render(" - Type a custom response"))
	content.WriteString("\n")

	// Navigation hint
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("↑/↓ navigate • Enter select • Esc cancel"))

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorBlue).
		Padding(1, 2).
		Width(m.width - 8).
		Render(content.String())
}

// renderStreamingIndicator renders the Claude Code-style activity indicator
func (m Model) renderStreamingIndicator() string {
	if !m.isRunning {
		return ""
	}

	elapsed := time.Since(m.streamStartTime)
	spinner := spinnerFrames[m.spinnerIndex%len(spinnerFrames)]
	// Change phrase every 2 seconds (20 spinner ticks at 100ms each)
	phraseIndex := int(elapsed.Seconds()/2) % len(activityPhrases)
	phrase := activityPhrases[phraseIndex]

	// Format: ⠙ Thinking… (ctrl+c to interrupt · 58s)
	indicator := fmt.Sprintf("%s %s… ", spinner, phrase)
	meta := fmt.Sprintf("(ctrl+c to interrupt · %ds)", int(elapsed.Seconds()))

	return lipgloss.NewStyle().
		Foreground(ColorYellow).
		Render(indicator) +
		lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render(meta)
}

// renderOutput renders the output area with fixed-height scrollable viewport
func (m Model) renderOutput(width, height int) string {
	// Header row with title and streaming indicator
	title := OutputHeaderStyle.Render("OUTPUT")
	if m.isRunning {
		title += "  " + m.renderStreamingIndicator()
	}

	// Scroll indicator (show position if content exceeds viewport)
	var scrollIndicator string
	totalLines := len(m.outputLines)
	viewportLines := height - 6 // Account for header, border, padding
	if totalLines > viewportLines && viewportLines > 0 {
		scrollIndicator = lipgloss.NewStyle().
			Foreground(ColorFgMuted).
			Render(fmt.Sprintf(" %d/%d", min(totalLines, viewportLines+m.viewport.YOffset), totalLines))
	}

	headerRow := lipgloss.JoinHorizontal(lipgloss.Left, title, scrollIndicator)

	// Content area - fixed height container
	contentHeight := height - 4 // Account for title row and borders
	if contentHeight < 1 {
		contentHeight = 1
	}
	contentWidth := width - 6 // Account for borders and padding
	if contentWidth < 10 {
		contentWidth = 10
	}

	var content string
	if len(m.outputLines) == 0 {
		// Placeholder content - centered in container
		placeholder := lipgloss.NewStyle().
			Foreground(ColorFgMuted).
			Width(contentWidth).
			Render("No output yet.\n\nUse /build or press b to start.\nPress / or i to focus input.")
		content = placeholder
	} else {
		// Use viewport content (already set in Update)
		content = m.viewport.View()
	}

	// Fixed-height content container (prevents layout shift)
	contentContainer := lipgloss.NewStyle().
		Width(contentWidth).
		Height(contentHeight).
		MaxHeight(contentHeight).
		Render(content)

	// Combine header and content
	inner := lipgloss.JoinVertical(lipgloss.Left,
		headerRow,
		"",
		contentContainer,
	)

	return OutputStyle.
		Width(width).
		Height(height).
		Render(inner)
}

// renderStatusBar renders the bottom status bar
func (m Model) renderStatusBar() string {
	// Status indicator
	var status string
	if m.isRunning {
		status = StatusRunningStyle.Render("● Running")
	} else {
		status = StatusIdleStyle.Render("○ Ready")
	}

	// Task count
	taskCount := lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render(" │ Tasks: " + itoa(len(m.tasks)))

	// Help hints - context sensitive
	var helpHint string
	mutedStyle := lipgloss.NewStyle().Foreground(ColorFgMuted)
	keyStyle := lipgloss.NewStyle().Foreground(ColorFgPrimary)

	if m.inputFocused {
		helpHint = mutedStyle.Render(" │ ") +
			keyStyle.Render("Enter") + mutedStyle.Render(" execute │ ") +
			keyStyle.Render("Tab") + mutedStyle.Render(" complete │ ") +
			keyStyle.Render("Esc") + mutedStyle.Render(" unfocus │ ") +
			keyStyle.Render("Ctrl+C") + mutedStyle.Render(" quit")
	} else if m.isRunning {
		helpHint = mutedStyle.Render(" │ ") +
			keyStyle.Render("i") + mutedStyle.Render(" message │ ") +
			keyStyle.Render("/add") + mutedStyle.Render(" task │ ") +
			keyStyle.Render("c") + mutedStyle.Render(" cancel │ ") +
			keyStyle.Render("Ctrl+C") + mutedStyle.Render(" quit")
	} else {
		helpHint = mutedStyle.Render(" │ ") +
			keyStyle.Render("b") + mutedStyle.Render(" build │ ") +
			keyStyle.Render("/") + mutedStyle.Render(" input │ ") +
			keyStyle.Render("?") + mutedStyle.Render(" help │ ") +
			keyStyle.Render("Esc") + mutedStyle.Render(" back │ ") +
			keyStyle.Render("Ctrl+C") + mutedStyle.Render(" quit")
	}

	return StatusBarStyle.Render(status + taskCount + helpHint)
}

// helpView renders the help overlay
func (m Model) helpView() string {
	title := HelpTitleStyle.Render("Keyboard Shortcuts")

	help := `
` + HelpKeyStyle.Render("?") + HelpDescStyle.Render("       Toggle help") + `
` + HelpKeyStyle.Render("b") + HelpDescStyle.Render("       Start build") + `
` + HelpKeyStyle.Render("c") + HelpDescStyle.Render("       Cancel build") + `
` + HelpKeyStyle.Render("r") + HelpDescStyle.Render("       Refresh status") + `
` + HelpKeyStyle.Render("n") + HelpDescStyle.Render("       New session") + `
` + HelpKeyStyle.Render("/ or i") + HelpDescStyle.Render("   Focus input") + `
` + HelpKeyStyle.Render("↑/k") + HelpDescStyle.Render("     Scroll up") + `
` + HelpKeyStyle.Render("↓/j") + HelpDescStyle.Render("     Scroll down") + `
` + HelpKeyStyle.Render("G") + HelpDescStyle.Render("       Jump to bottom") + `
` + HelpKeyStyle.Render("Esc") + HelpDescStyle.Render("     Back/unfocus") + `
` + HelpKeyStyle.Render("q") + HelpDescStyle.Render("       Quit") + `
`

	content := title + "\n" + help + "\n" + HelpDescStyle.Render("Press ? or Esc to close")

	// Center the help box
	helpBox := HelpStyle.Render(content)

	return lipgloss.Place(
		m.width,
		m.height,
		lipgloss.Center,
		lipgloss.Center,
		helpBox,
	)
}

// setupView renders the issue tracker selection screen
func (m Model) setupView() string {
	title := lipgloss.NewStyle().
		Foreground(ColorBlue).
		Bold(true).
		MarginBottom(1).
		Render("Select Issue Tracker")

	var content strings.Builder
	content.WriteString(title)
	content.WriteString("\n\n")

	for i, t := range m.trackers {
		var line string
		if i == m.setupIdx {
			// Selected item - highlighted
			style := lipgloss.NewStyle().
				Background(ColorBgHighlight).
				Foreground(ColorFgPrimary).
				Bold(true).
				Padding(0, 1)
			if !t.Available {
				style = style.Foreground(ColorFgMuted)
			}
			line = style.Render("▸ " + t.Name)
		} else {
			// Normal item
			style := lipgloss.NewStyle().
				Foreground(ColorFgPrimary).
				Padding(0, 1)
			if !t.Available {
				style = style.Foreground(ColorFgMuted)
			}
			line = style.Render("  " + t.Name)
		}

		// Add description
		desc := lipgloss.NewStyle().
			Foreground(ColorFgMuted).
			Render(" - " + t.Description)

		content.WriteString(line + desc)
		content.WriteString("\n")
	}

	// Add navigation hint
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("↑/↓ navigate • Enter select • q quit"))

	// Center the selection box
	selectionBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorBorder).
		Padding(1, 2).
		Render(content.String())

	return lipgloss.Place(
		m.width,
		m.height,
		lipgloss.Center,
		lipgloss.Center,
		selectionBox,
	)
}

// selectionView renders the epic selection screen
func (m Model) selectionView() string {
	title := lipgloss.NewStyle().
		Foreground(ColorBlue).
		Bold(true).
		MarginBottom(1).
		Render("Select Epic")

	var content strings.Builder
	content.WriteString(title)
	content.WriteString("\n\n")

	if m.loadingEpics {
		// Show loading spinner
		spinner := spinnerFrames[m.spinnerIndex%len(spinnerFrames)]
		content.WriteString(lipgloss.NewStyle().
			Foreground(ColorYellow).
			Render(spinner + " Loading epics..."))
	} else if len(m.sessions) == 0 {
		content.WriteString(lipgloss.NewStyle().
			Foreground(ColorFgMuted).
			Render("No epics found.\n\nPress n to create a new session."))
	} else {
		for i, s := range m.sessions {
			var line string
			if i == m.selectedIndex {
				// Selected item - highlighted
				line = lipgloss.NewStyle().
					Background(ColorBgHighlight).
					Foreground(ColorFgPrimary).
					Bold(true).
					Padding(0, 1).
					Render("▸ " + s.Name)
			} else {
				// Normal item
				line = lipgloss.NewStyle().
					Foreground(ColorFgPrimary).
					Padding(0, 1).
					Render("  " + s.Name)
			}
			content.WriteString(line)
			content.WriteString("\n")
		}
	}

	// Add navigation hint
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("↑/↓ navigate • Enter select • n new • q quit"))

	// Center the selection box
	selectionBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorBorder).
		Padding(1, 2).
		Render(content.String())

	return lipgloss.Place(
		m.width,
		m.height,
		lipgloss.Center,
		lipgloss.Center,
		selectionBox,
	)
}

// executeCommand parses and executes a command string
func (m *Model) executeCommand(cmd string) tea.Cmd {
	cmd = strings.TrimSpace(cmd)

	// If not a command (doesn't start with / or :) and process is running, send as message to Claude
	if !strings.HasPrefix(cmd, "/") && !strings.HasPrefix(cmd, ":") {
		if m.isRunning && m.processHandle != nil {
			return m.sendMessageToAgent(cmd)
		}
		// Not running - show hint
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "No process running. Use /plan or /build to start.",
			Type: "stderr",
		})
		return nil
	}

	switch {
	case strings.HasPrefix(cmd, "/plan"):
		input := strings.TrimSpace(strings.TrimPrefix(cmd, "/plan"))
		return m.startPlan(input)

	case strings.HasPrefix(cmd, "/build"):
		return m.startBuild()

	case strings.HasPrefix(cmd, "/add"):
		input := strings.TrimSpace(strings.TrimPrefix(cmd, "/add"))
		return m.addTask(input)

	case cmd == "/cancel":
		if m.isRunning && m.processHandle != nil {
			m.processHandle.Kill()
			m.isRunning = false
			m.buildLoopRunning = false
			m.currentIteration = 0
			m.outputLines = append(m.outputLines, process.OutputLine{
				Text: "Build cancelled",
				Type: "system",
			})
		}
		return nil

	case cmd == "/clear":
		m.outputLines = nil
		return nil

	case cmd == "/status":
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: fmt.Sprintf("Status: %s", map[bool]string{true: "Running", false: "Idle"}[m.isRunning]),
			Type: "system",
		})
		return nil

	case cmd == "/help":
		m.viewMode = ViewModeHelp
		return nil

	default:
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "Unknown command: " + cmd,
			Type: "stderr",
		})
		return nil
	}
}

// sendQuestionResponse sends the user's response to a question back to Claude
func (m *Model) sendQuestionResponse(response string) {
	if m.processHandle == nil {
		return
	}

	// Get the tool_use_id from the pending question
	var toolUseID string
	if m.pendingQuestion != nil {
		toolUseID = m.pendingQuestion.ToolUseID
	}

	var err error
	if toolUseID != "" {
		// Send as tool result (proper format for AskUserQuestion responses)
		err = m.processHandle.SendToolResult(toolUseID, response)
	} else {
		// Fallback to regular message if no tool_use_id (shouldn't happen)
		err = m.processHandle.SendMessage(response)
	}

	if err != nil {
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "Failed to send response: " + err.Error(),
			Type: "stderr",
		})
	} else {
		// Show user's response in output
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "You: " + response,
			Type: "system",
		})
	}

	// Update viewport to show the message
	m.viewport.SetContent(m.renderOutputContent())
	m.viewport.GotoBottom()
}

// addTask creates a new task in beads for the current epic
// Only available during build mode - runs non-blocking so build continues
func (m *Model) addTask(title string) tea.Cmd {
	// Must be in build mode
	if !m.buildLoopRunning {
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "/add is only available during build mode. Run /build first.",
			Type: "stderr",
		})
		return nil
	}

	// Need a title
	if title == "" {
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "Usage: /add <task title>",
			Type: "stderr",
		})
		return nil
	}

	// Need an active session/epic
	if m.activeSession == nil {
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "No active epic selected.",
			Type: "stderr",
		})
		return nil
	}

	// Run bd create in background (non-blocking)
	return m.runAddTask(title, m.activeSession.EpicID)
}

// runAddTask executes bd create and refreshes tasks
func (m *Model) runAddTask(title, epicID string) tea.Cmd {
	return func() tea.Msg {
		// Execute bd create
		cmd := exec.Command("bd", "create",
			"--title", title,
			"--type", "task",
			"--parent", epicID,
		)
		output, err := cmd.CombinedOutput()

		if err != nil {
			return taskAddedMsg{success: false, err: err.Error()}
		}
		return taskAddedMsg{success: true, output: string(output)}
	}
}

// sendMessageToAgent sends free-form text to the running Claude process
func (m *Model) sendMessageToAgent(message string) tea.Cmd {
	if m.processHandle == nil {
		return nil
	}

	// Show user's message in output
	m.outputLines = append(m.outputLines, process.OutputLine{
		Text: "You: " + message,
		Type: "system",
	})

	// Update viewport to show the message
	m.viewport.SetContent(m.renderOutputContent())
	m.viewport.GotoBottom()

	// Send to process (reuse existing SendMessage method)
	err := m.processHandle.SendMessage(message)
	if err != nil {
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "Failed to send message: " + err.Error(),
			Type: "stderr",
		})
		m.viewport.SetContent(m.renderOutputContent())
		m.viewport.GotoBottom()
	}

	return nil
}

// startBuild starts the build loop (Ralph Wiggum loop)
func (m *Model) startBuild() tea.Cmd {
	if m.isRunning {
		return nil
	}

	// Reset streaming state to ensure clean detection for new build
	process.ResetStreamingState()

	// Initialize build loop state
	m.isRunning = true
	m.buildLoopRunning = true
	m.currentIteration = 0
	m.maxIterations = m.defaultMaxIters

	// Clear output and show build header
	m.outputLines = nil

	if m.activeSession != nil {
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: fmt.Sprintf("Building: %s", m.activeSession.Name),
			Type: "system",
		})
	} else {
		m.outputLines = append(m.outputLines, process.OutputLine{
			Text: "Starting build...",
			Type: "system",
		})
	}

	// Start first iteration and spinner (spinner will self-sustain while isRunning)
	return tea.Batch(m.runNextBuildIteration(), spinnerTickCmd())
}

// runNextBuildIteration starts the next iteration of the build loop
func (m *Model) runNextBuildIteration() tea.Cmd {
	if !m.buildLoopRunning {
		return nil
	}

	// Reset streaming state from previous iteration to avoid stale TASK_COMPLETE detection
	process.ResetStreamingState()

	m.currentIteration++
	m.outputChan = make(chan process.OutputLine, 100)

	// Initialize streaming indicator state
	m.streamStartTime = time.Now()
	m.spinnerIndex = 0

	var epicID string
	if m.activeSession != nil {
		epicID = m.activeSession.EpicID
	}

	m.outputLines = append(m.outputLines, process.OutputLine{
		Text: fmt.Sprintf("🔄 Iteration %d/%d · New Claude session", m.currentIteration, m.maxIterations),
		Type: "system",
	})
	m.outputLines = append(m.outputLines, process.OutputLine{
		Text: "",
		Type: "system",
	})

	m.processHandle = process.RunBuildIteration(m.currentIteration, m.maxIterations, epicID, m.outputChan)

	return m.pollOutput()
}

// startPlan starts the plan process
func (m *Model) startPlan(input string) tea.Cmd {
	if m.isRunning {
		return nil
	}

	m.isRunning = true
	m.outputChan = make(chan process.OutputLine, 100)

	// Initialize streaming indicator state
	m.streamStartTime = time.Now()
	m.spinnerIndex = 0

	m.processHandle = process.RunPlan(input, m.outputChan)

	m.outputLines = append(m.outputLines, process.OutputLine{
		Text: "Starting plan...",
		Type: "system",
	})

	// Start polling and spinner (spinner will self-sustain while isRunning)
	return tea.Batch(m.pollOutput(), spinnerTickCmd())
}

// waitForOutput returns a command that blocks until output is available
// and then drains all immediately available lines for efficiency.
// IMPORTANT: When channel closes, returns pollingStoppedMsg (not processFinishedMsg).
// The actual exit code must come from an explicit "exit" type line, not channel close.
// This prevents duplicate processFinishedMsg when multiple poll commands are in flight.
func waitForOutput(outputChan <-chan process.OutputLine) tea.Cmd {
	return func() tea.Msg {
		if outputChan == nil {
			return nil
		}

		// First, block until we get at least one line
		line, ok := <-outputChan
		if !ok {
			// Channel closed - return benign message, not processFinishedMsg
			// (the real exit code comes from the "exit" type line)
			return pollingStoppedMsg{}
		}

		// Start with the first line
		lines := []process.OutputLine{line}

		// Then drain any additional immediately available lines (non-blocking)
		for {
			select {
			case l, ok := <-outputChan:
				if !ok {
					// Channel closed, return what we have
					if len(lines) > 0 {
						return outputBatchMsg{lines: lines}
					}
					return pollingStoppedMsg{}
				}
				lines = append(lines, l)
			default:
				// No more immediately available data
				if len(lines) == 1 {
					return outputLineMsg{line: lines[0]}
				}
				return outputBatchMsg{lines: lines}
			}
		}
	}
}

// pollOutput is a convenience method that calls waitForOutput
func (m *Model) pollOutput() tea.Cmd {
	return waitForOutput(m.outputChan)
}

// renderOutputContent renders the output lines as a string with block-level styling
func (m Model) renderOutputContent() string {
	var sb strings.Builder

	// Get available width for text wrapping (viewport width minus styling overhead)
	wrapWidth := m.viewport.Width - 4 // Account for borders/padding in blocks
	if wrapWidth < 20 {
		wrapWidth = 20
	}

	// Combine consecutive assistant lines into single blocks
	i := 0
	for i < len(m.outputLines) {
		line := m.outputLines[i]
		text := strings.TrimRight(line.Text, "\n")

		switch line.Type {
		case "assistant":
			// Collect all consecutive assistant lines
			var assistantText strings.Builder
			assistantText.WriteString(text)
			i++
			for i < len(m.outputLines) && m.outputLines[i].Type == "assistant" {
				assistantText.WriteString(strings.TrimRight(m.outputLines[i].Text, "\n"))
				i++
			}
			// Render combined assistant text as one block
			fullText := assistantText.String()
			if fullText != "" {
				wrappedText := wrapText(fullText, wrapWidth-4)
				block := AssistantStyle.Width(wrapWidth).Render(
					lipgloss.NewStyle().Foreground(ColorFgPrimary).Render(wrappedText),
				)
				sb.WriteString(block)
				sb.WriteString("\n")
			}
			continue // Skip the i++ at the end since we already incremented

		case "tool_call":
			// Tool calls - yellow left border with lightning icon
			toolText := "⚡ " + line.ToolName
			if rest := strings.TrimPrefix(text, "● "+line.ToolName); rest != "" {
				rest = strings.TrimSpace(rest)
				// Truncate long tool args but show more context
				maxLen := wrapWidth - len(line.ToolName) - 6
				if maxLen < 20 {
					maxLen = 20
				}
				if len(rest) > maxLen {
					rest = rest[:maxLen-3] + "..."
				}
				if rest != "" {
					toolText += " " + lipgloss.NewStyle().Foreground(ColorFgMuted).Render(rest)
				}
			}
			block := ToolCallStyle.Width(wrapWidth).Render(
				lipgloss.NewStyle().Foreground(ColorYellow).Render(toolText),
			)
			sb.WriteString(block)
			sb.WriteString("\n")

		case "tool_result":
			// Tool results - indented with muted arrow, truncated (user says truncation is fine)
			truncatedResult := text
			maxLen := wrapWidth - 6
			if maxLen < 20 {
				maxLen = 20
			}
			if len(truncatedResult) > maxLen {
				truncatedResult = truncatedResult[:maxLen-3] + "..."
			}
			resultText := "↳ " + truncatedResult
			sb.WriteString(ToolResultStyle.Width(wrapWidth).Render(resultText))
			sb.WriteString("\n")

		case "stderr":
			// Errors - red bullet, wrapped (show full errors)
			wrappedErr := wrapText(text, wrapWidth-2)
			sb.WriteString(ErrorStyle.Width(wrapWidth).Render("● " + wrappedErr))
			sb.WriteString("\n")

		case "question":
			// Questions from Claude - blue left border with question icon
			questionText := "❓ " + line.ToolName
			if line.Question != nil {
				questionText = "❓ " + line.Question.Question
			}
			wrappedQ := wrapText(questionText, wrapWidth-4)
			block := lipgloss.NewStyle().
				BorderLeft(true).
				BorderStyle(lipgloss.ThickBorder()).
				BorderForeground(ColorBlue).
				PaddingLeft(1).
				Width(wrapWidth).
				Render(lipgloss.NewStyle().Foreground(ColorBlue).Render(wrappedQ))
			sb.WriteString(block)
			sb.WriteString("\n")

		case "system":
			// System messages - magenta left border block, wrapped
			wrappedSys := wrapText(text, wrapWidth-4)
			block := SystemStyle.Width(wrapWidth).Render(
				SystemTextStyle.Render(wrappedSys),
			)
			sb.WriteString(block)
			sb.WriteString("\n")

		default:
			// Default - plain text, wrapped
			wrappedDefault := wrapText(text, wrapWidth)
			sb.WriteString(lipgloss.NewStyle().Foreground(ColorFgPrimary).Width(wrapWidth).Render(wrappedDefault))
			sb.WriteString("\n")
		}
		i++
	}

	return sb.String()
}

// getFilteredSuggestions returns commands that match the current input
func (m Model) getFilteredSuggestions() []struct {
	cmd  string
	desc string
} {
	inputVal := m.input.Value()
	if !strings.HasPrefix(inputVal, "/") {
		return nil
	}

	var filtered []struct {
		cmd  string
		desc string
	}
	for _, c := range availableCommands {
		if strings.HasPrefix(c.cmd, inputVal) {
			filtered = append(filtered, c)
		}
	}
	return filtered
}

// Helper functions
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}

func itoa(i int) string {
	return fmt.Sprintf("%d", i)
}

// isSuccessfulExit returns true if the exit code indicates successful task completion.
// This includes clean exits (0) and killed processes (which happen when we force-terminate
// after TASK_COMPLETE is detected via CloseStdinWithTimeout).
func isSuccessfulExit(exitCode int) bool {
	if exitCode == 0 {
		return true
	}
	// Killed processes: -1 on macOS, or 128+signal on Linux
	// SIGKILL (9) = 137, SIGTERM (15) = 143
	if exitCode == -1 || exitCode == 137 || exitCode == 143 {
		return true
	}
	return false
}

// wrapText wraps text to fit within a given width, preserving word boundaries
func wrapText(text string, width int) string {
	if width <= 0 {
		return text
	}

	var result strings.Builder
	lines := strings.Split(text, "\n")

	for i, line := range lines {
		if i > 0 {
			result.WriteString("\n")
		}

		// If line fits, just add it
		if len(line) <= width {
			result.WriteString(line)
			continue
		}

		// Wrap long lines at word boundaries
		words := strings.Fields(line)
		currentLine := ""

		for _, word := range words {
			if currentLine == "" {
				// First word on line
				if len(word) > width {
					// Word is longer than width, force break
					for len(word) > width {
						result.WriteString(word[:width])
						result.WriteString("\n")
						word = word[width:]
					}
					currentLine = word
				} else {
					currentLine = word
				}
			} else if len(currentLine)+1+len(word) <= width {
				// Word fits on current line
				currentLine += " " + word
			} else {
				// Word doesn't fit, start new line
				result.WriteString(currentLine)
				result.WriteString("\n")
				if len(word) > width {
					// Word is longer than width, force break
					for len(word) > width {
						result.WriteString(word[:width])
						result.WriteString("\n")
						word = word[width:]
					}
					currentLine = word
				} else {
					currentLine = word
				}
			}
		}

		// Write remaining content
		if currentLine != "" {
			result.WriteString(currentLine)
		}
	}

	return result.String()
}
