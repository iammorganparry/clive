package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/clive/tui-go/internal/beads"
	"github.com/clive/tui-go/internal/model"
	"github.com/clive/tui-go/internal/process"
)

// ViewMode represents the current view
type ViewMode int

const (
	ViewModeSelection ViewMode = iota
	ViewModeMain
	ViewModeHelp
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

// Model is the root Bubble Tea model
type Model struct {
	// Terminal dimensions
	width  int
	height int

	// View state
	viewMode ViewMode

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

	// Key bindings
	keys KeyMap

	// Ready state
	ready bool

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
	{"/cancel", "Cancel running process"},
	{"/clear", "Clear output"},
	{"/status", "Show current status"},
	{"/help", "Show help"},
}

// NewRootModel creates a new root model
func NewRootModel() Model {
	// Create text input
	ti := textinput.New()
	ti.Placeholder = "Enter command..."
	ti.Prompt = "❯ "
	ti.PromptStyle = InputPromptStyle
	ti.CharLimit = 256

	return Model{
		viewMode:      ViewModeSelection, // Start with epic selection
		input:         ti,
		inputFocused:  false,
		keys:          DefaultKeyMap(),
		ready:         false,
		selectedIndex: 0,
	}
}

// Init initializes the model
func (m Model) Init() tea.Cmd {
	return tea.Batch(
		tea.EnterAltScreen,
		textinput.Blink,
		loadEpics(),
		tickCmd(),
	)
}

// loadEpics loads epics from beads
func loadEpics() tea.Cmd {
	return func() tea.Msg {
		sessions := beads.GetEpics(true) // Filter by current user
		return epicsLoadedMsg{sessions: sessions}
	}
}

// loadTasks loads tasks for an epic
func loadTasks(epicID string) tea.Cmd {
	return func() tea.Msg {
		tasks := beads.GetEpicTasks(epicID)
		return tasksLoadedMsg{tasks: tasks}
	}
}

// tickCmd returns a tick command for polling
func tickCmd() tea.Cmd {
	return tea.Tick(5*time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
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

		// Re-render content if we have output
		if len(m.outputLines) > 0 {
			m.viewport.SetContent(m.renderOutputContent())
			m.viewport.GotoBottom()
		}

	case epicsLoadedMsg:
		m.sessions = msg.sessions

	case tasksLoadedMsg:
		m.tasks = msg.tasks

	case outputLineMsg:
		m.outputLines = append(m.outputLines, msg.line)
		// Keep only last 500 lines
		if len(m.outputLines) > 500 {
			m.outputLines = m.outputLines[len(m.outputLines)-500:]
		}
		// Update viewport content
		m.viewport.SetContent(m.renderOutputContent())
		m.viewport.GotoBottom()
		// Continue polling for more output
		if m.outputChan != nil {
			cmds = append(cmds, m.pollOutput())
		}

	case outputBatchMsg:
		m.outputLines = append(m.outputLines, msg.lines...)
		// Keep only last 500 lines
		if len(m.outputLines) > 500 {
			m.outputLines = m.outputLines[len(m.outputLines)-500:]
		}
		// Update viewport content
		m.viewport.SetContent(m.renderOutputContent())
		m.viewport.GotoBottom()
		// Continue polling for more output
		if m.outputChan != nil {
			cmds = append(cmds, m.pollOutput())
		}

	case processFinishedMsg:
		m.isRunning = false
		m.processHandle = nil
		if m.outputChan != nil {
			close(m.outputChan)
			m.outputChan = nil
		}
		// Refresh tasks after process finishes
		if m.activeSession != nil {
			cmds = append(cmds, loadTasks(m.activeSession.EpicID))
		}

	case tickMsg:
		// Refresh data periodically
		cmds = append(cmds, tickCmd())
		// Check for output from process
		if m.outputChan != nil {
			cmds = append(cmds, m.pollOutput())
		}
		// Refresh epics and tasks
		if m.activeSession != nil {
			cmds = append(cmds, loadTasks(m.activeSession.EpicID))
		}

	case tea.KeyMsg:
		// Ctrl+C always quits, regardless of state
		if msg.Type == tea.KeyCtrlC {
			return m, tea.Quit
		}

		// Handle input when focused
		if m.inputFocused {
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
					cmds = append(cmds, loadTasks(m.activeSession.EpicID))
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
				m.outputLines = append(m.outputLines, process.OutputLine{
					Text: "Build cancelled",
					Type: "system",
				})
			}
			return m, tea.Batch(cmds...)

		case key.Matches(msg, m.keys.Refresh):
			// Refresh epics and tasks
			cmds = append(cmds, loadEpics())
			if m.activeSession != nil {
				cmds = append(cmds, loadTasks(m.activeSession.EpicID))
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
	if !m.ready {
		return "Loading..."
	}

	switch m.viewMode {
	case ViewModeHelp:
		return m.helpView()
	case ViewModeSelection:
		return m.selectionView()
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

	// Add padding and return with newline
	return lipgloss.NewStyle().
		PaddingLeft(1).
		PaddingBottom(1).
		Render(headerLine)
}

// renderInput renders the command input with suggestions
func (m Model) renderInput() string {
	var result strings.Builder

	// Render suggestions panel if active
	if m.showSuggestions && m.inputFocused {
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

	if len(inProgress) > 0 {
		content += TaskInProgressStyle.Render("In Progress") + "\n"
		for _, t := range inProgress {
			content += TaskInProgressStyle.Render("  ● "+truncate(t.Title, width-6)) + "\n"
		}
		content += "\n"
	}

	if len(pending) > 0 {
		content += TaskPendingStyle.Render("Pending") + "\n"
		for _, t := range pending {
			content += TaskPendingStyle.Render("  ○ "+truncate(t.Title, width-6)) + "\n"
		}
		content += "\n"
	}

	if len(complete) > 0 {
		content += TaskCompleteStyle.Render("Complete") + "\n"
		for _, t := range complete {
			content += TaskCompleteStyle.Render("  ✓ "+truncate(t.Title, width-6)) + "\n"
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

// renderOutput renders the output area with fixed-height scrollable viewport
func (m Model) renderOutput(width, height int) string {
	// Header row with title and scroll indicator
	title := OutputHeaderStyle.Render("OUTPUT")
	if m.isRunning {
		title += lipgloss.NewStyle().
			Foreground(ColorGreen).
			Render(" · streaming")
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
			keyStyle.Render("c") + mutedStyle.Render(" cancel │ ") +
			keyStyle.Render("/") + mutedStyle.Render(" input │ ") +
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

	if len(m.sessions) == 0 {
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

	switch {
	case strings.HasPrefix(cmd, "/plan"):
		input := strings.TrimSpace(strings.TrimPrefix(cmd, "/plan"))
		return m.startPlan(input)

	case strings.HasPrefix(cmd, "/build"):
		return m.startBuild()

	case cmd == "/cancel":
		if m.isRunning && m.processHandle != nil {
			m.processHandle.Kill()
			m.isRunning = false
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

// startBuild starts a build iteration
func (m *Model) startBuild() tea.Cmd {
	if m.isRunning {
		return nil
	}

	m.isRunning = true
	m.outputChan = make(chan process.OutputLine, 100)

	var epicID string
	if m.activeSession != nil {
		epicID = m.activeSession.EpicID
	}

	m.processHandle = process.RunBuildIteration(1, 50, epicID, m.outputChan)

	m.outputLines = append(m.outputLines, process.OutputLine{
		Text: "Starting build...",
		Type: "system",
	})

	return m.pollOutput()
}

// startPlan starts the plan process
func (m *Model) startPlan(input string) tea.Cmd {
	if m.isRunning {
		return nil
	}

	m.isRunning = true
	m.outputChan = make(chan process.OutputLine, 100)

	m.processHandle = process.RunPlan(input, m.outputChan)

	m.outputLines = append(m.outputLines, process.OutputLine{
		Text: "Starting plan...",
		Type: "system",
	})

	return m.pollOutput()
}

// waitForOutput returns a command that blocks until output is available
// and then drains all immediately available lines for efficiency
func waitForOutput(outputChan <-chan process.OutputLine) tea.Cmd {
	return func() tea.Msg {
		if outputChan == nil {
			return nil
		}

		// First, block until we get at least one line
		line, ok := <-outputChan
		if !ok {
			return processFinishedMsg{exitCode: 0}
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
					return processFinishedMsg{exitCode: 0}
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

	for _, line := range m.outputLines {
		text := strings.TrimRight(line.Text, "\n")

		switch line.Type {
		case "assistant":
			// Assistant responses - blue left border block with word wrapping
			wrappedText := wrapText(text, wrapWidth-4) // Extra padding for block style
			block := AssistantStyle.Width(wrapWidth).Render(
				lipgloss.NewStyle().Foreground(ColorFgPrimary).Render(wrappedText),
			)
			sb.WriteString(block)
			sb.WriteString("\n")

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
			// Tool results - indented with muted arrow, wrapped
			wrappedResult := wrapText(text, wrapWidth-6)
			resultText := "↳ " + wrappedResult
			sb.WriteString(ToolResultStyle.Width(wrapWidth).Render(resultText))
			sb.WriteString("\n")

		case "stderr":
			// Errors - red bullet, wrapped
			wrappedErr := wrapText(text, wrapWidth-2)
			sb.WriteString(ErrorStyle.Width(wrapWidth).Render("● " + wrappedErr))
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
