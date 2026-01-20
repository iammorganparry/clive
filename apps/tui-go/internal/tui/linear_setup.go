package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/clive/tui-go/internal/linear"
)

// LinearSetupStep tracks the current step in Linear setup flow
type LinearSetupStep int

const (
	LinearStepSelectTracker  LinearSetupStep = iota // Initial tracker selection
	LinearStepCheckMCP                              // Checking if MCP is configured
	LinearStepNeedMCP                               // Needs MCP configuration via Claude
	LinearStepConfigureMCP                          // Running Claude to configure MCP
	LinearStepNeedAPIKey                            // Needs API key for direct access
	LinearStepValidatingKey                         // Validating API key
	LinearStepFetchTeams                            // Fetching teams
	LinearStepSelectTeam                            // Team selection (if multiple)
	LinearStepComplete                              // Done
)

// LinearSetup encapsulates all Linear setup state and logic
type LinearSetup struct {
	Step          LinearSetupStep // Current step in setup flow
	APIKey        string          // API key for direct Linear API access
	APIKeyInput   textinput.Model // Input for API key entry
	Token         string          // OAuth token from Keychain (for MCP validation)
	Teams         []linear.Team   // Available teams from Linear
	TeamIdx       int             // Selected team index
	Error         string          // Error message to display
	SpinnerIndex  int             // For loading animation
	Width, Height int             // Terminal dimensions for centering
}

// NewLinearSetup creates a new Linear setup component
func NewLinearSetup() LinearSetup {
	apiKeyInput := textinput.New()
	apiKeyInput.Placeholder = "lin_api_..."
	apiKeyInput.Prompt = "API Key: "
	apiKeyInput.PromptStyle = InputPromptStyle
	apiKeyInput.EchoMode = textinput.EchoPassword // Hide the key
	apiKeyInput.CharLimit = 100
	apiKeyInput.Width = 50

	return LinearSetup{
		Step:        LinearStepSelectTracker,
		APIKeyInput: apiKeyInput,
	}
}

// --- Messages ---

// linearAuthCheckedMsg is sent after checking Linear authentication status
type linearAuthCheckedMsg struct {
	authenticated bool
	token         string
	err           error
}

// linearTeamsFetchedMsg is sent after fetching Linear teams
type linearTeamsFetchedMsg struct {
	teams []linear.Team
	err   error
}

// linearAuthStartedMsg is sent when authentication process starts
type linearAuthStartedMsg struct{}

// linearAuthCompletedMsg is sent when authentication completes (user returned from browser)
type linearAuthCompletedMsg struct {
	success bool
	err     error
}

// linearAPIKeyValidatedMsg is sent after validating the API key
type linearAPIKeyValidatedMsg struct {
	valid bool
	teams []linear.Team
	err   error
}

// --- Commands ---

// CheckLinearAuthCmd checks if Linear is authenticated via MCP
func CheckLinearAuthCmd() tea.Cmd {
	return func() tea.Msg {
		token, err := linear.GetLinearTokenFromKeychain()
		if err != nil {
			return linearAuthCheckedMsg{authenticated: false, err: err}
		}
		return linearAuthCheckedMsg{authenticated: true, token: token}
	}
}

// FetchLinearTeamsCmd fetches teams from Linear
func FetchLinearTeamsCmd(token string) tea.Cmd {
	return func() tea.Msg {
		client := linear.NewClient(token)
		teams, err := client.GetTeams()
		if err != nil {
			return linearTeamsFetchedMsg{err: err}
		}
		return linearTeamsFetchedMsg{teams: teams}
	}
}

// ValidateLinearAPIKeyCmd validates the API key by fetching teams
func ValidateLinearAPIKeyCmd(apiKey string) tea.Cmd {
	return func() tea.Msg {
		client := linear.NewClient(apiKey)
		teams, err := client.GetTeams()
		if err != nil {
			return linearAPIKeyValidatedMsg{valid: false, err: err}
		}
		return linearAPIKeyValidatedMsg{valid: true, teams: teams}
	}
}

// StartLinearAuthCmd starts the Linear authentication process
// It uses tea.ExecProcess to suspend the TUI and run Claude interactively
func StartLinearAuthCmd() tea.Cmd {
	// First, ensure Linear MCP is configured (do this synchronously)
	if !linear.IsLinearMCPConfigured() {
		if err := linear.ConfigureLinearMCP(); err != nil {
			return func() tea.Msg {
				return linearAuthCompletedMsg{success: false, err: fmt.Errorf("failed to configure Linear MCP: %w", err)}
			}
		}
	}

	// Use tea.ExecProcess to run Claude interactively
	cmd := linear.GetLinearAuthCommand()
	return tea.ExecProcess(cmd, func(err error) tea.Msg {
		if err != nil {
			return linearAuthCompletedMsg{success: false, err: err}
		}
		return linearAuthCompletedMsg{success: true}
	})
}

// --- Update Logic ---

// HandleMessage processes messages related to Linear setup
// Returns: updated setup, commands to execute, and whether the message was handled
func (ls LinearSetup) HandleMessage(msg tea.Msg, keys KeyMap) (LinearSetup, tea.Cmd, bool) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case linearAuthCheckedMsg:
		if msg.authenticated {
			ls.Token = msg.token
			ls.Step = LinearStepComplete
			// Will need to save config - return a signal for that
			return ls, nil, true
		}
		ls.Step = LinearStepNeedMCP
		if msg.err != nil {
			ls.Error = "MCP authentication needed: " + msg.err.Error()
		}
		return ls, nil, true

	case linearTeamsFetchedMsg:
		if msg.err != nil {
			ls.Error = "Failed to fetch teams: " + msg.err.Error()
			ls.Step = LinearStepNeedAPIKey
			ls.APIKeyInput.Focus()
			return ls, nil, true
		}
		ls.Teams = msg.teams
		if len(msg.teams) == 0 {
			ls.Error = "No teams found in your Linear account"
			ls.Step = LinearStepNeedAPIKey
			ls.APIKeyInput.Focus()
			return ls, nil, true
		}
		ls.Step = LinearStepSelectTeam
		ls.TeamIdx = 0
		return ls, nil, true

	case linearAuthCompletedMsg:
		if msg.success {
			ls.Step = LinearStepCheckMCP
			return ls, CheckLinearAuthCmd(), true
		}
		ls.Error = "MCP authentication failed"
		if msg.err != nil {
			ls.Error = msg.err.Error()
		}
		ls.Step = LinearStepNeedMCP
		return ls, nil, true

	case linearAPIKeyValidatedMsg:
		if msg.valid {
			ls.Teams = msg.teams
			ls.Error = ""
			if len(msg.teams) == 0 {
				ls.Error = "No teams found in your Linear account"
				ls.Step = LinearStepNeedAPIKey
				ls.APIKeyInput.Focus()
				return ls, nil, true
			}
			ls.Step = LinearStepSelectTeam
			ls.TeamIdx = 0
			return ls, nil, true
		}
		ls.Error = "Invalid API key"
		if msg.err != nil {
			ls.Error = "Invalid API key: " + msg.err.Error()
		}
		ls.Step = LinearStepNeedAPIKey
		ls.APIKeyInput.Focus()
		return ls, nil, true

	case tea.KeyMsg:
		return ls.handleKeyMsg(msg, keys, cmds)
	}

	return ls, nil, false
}

func (ls LinearSetup) handleKeyMsg(msg tea.KeyMsg, keys KeyMap, cmds []tea.Cmd) (LinearSetup, tea.Cmd, bool) {
	// Handle API key entry step
	if ls.Step == LinearStepNeedAPIKey {
		switch msg.Type {
		case tea.KeyEnter:
			apiKey := ls.APIKeyInput.Value()
			if apiKey == "" {
				ls.Error = "Please enter your Linear API key"
				return ls, nil, true
			}
			ls.APIKey = apiKey
			ls.Step = LinearStepValidatingKey
			ls.Error = ""
			return ls, ValidateLinearAPIKeyCmd(apiKey), true
		case tea.KeyEsc:
			ls.Step = LinearStepSelectTracker
			ls.Error = ""
			ls.APIKeyInput.SetValue("")
			return ls, nil, true
		default:
			var cmd tea.Cmd
			ls.APIKeyInput, cmd = ls.APIKeyInput.Update(msg)
			return ls, cmd, true
		}
	}

	// Handle team selection step
	if ls.Step == LinearStepSelectTeam {
		switch {
		case key.Matches(msg, keys.Up):
			if ls.TeamIdx > 0 {
				ls.TeamIdx--
			}
			return ls, nil, true
		case key.Matches(msg, keys.Down):
			if ls.TeamIdx < len(ls.Teams)-1 {
				ls.TeamIdx++
			}
			return ls, nil, true
		case key.Matches(msg, keys.Enter):
			if ls.TeamIdx < len(ls.Teams) {
				ls.Step = LinearStepCheckMCP
				return ls, CheckLinearAuthCmd(), true
			}
			return ls, nil, true
		case key.Matches(msg, keys.Escape):
			ls.Step = LinearStepNeedAPIKey
			ls.APIKeyInput.Focus()
			ls.Error = ""
			return ls, nil, true
		}
		return ls, nil, true
	}

	// Handle MCP auth needed step
	if ls.Step == LinearStepNeedMCP {
		switch {
		case key.Matches(msg, keys.Enter):
			ls.Step = LinearStepConfigureMCP
			ls.Error = ""
			return ls, StartLinearAuthCmd(), true
		case key.Matches(msg, keys.Escape):
			if len(ls.Teams) > 1 {
				ls.Step = LinearStepSelectTeam
			} else {
				ls.Step = LinearStepNeedAPIKey
				ls.APIKeyInput.Focus()
			}
			ls.Error = ""
			return ls, nil, true
		}
		return ls, nil, true
	}

	// Loading/validating states - no key handling except quit
	if ls.Step == LinearStepCheckMCP ||
		ls.Step == LinearStepValidatingKey ||
		ls.Step == LinearStepFetchTeams ||
		ls.Step == LinearStepConfigureMCP {
		return ls, nil, true
	}

	return ls, nil, false
}

// IsLoading returns true if the setup is in a loading state
func (ls LinearSetup) IsLoading() bool {
	return ls.Step == LinearStepValidatingKey ||
		ls.Step == LinearStepCheckMCP ||
		ls.Step == LinearStepFetchTeams ||
		ls.Step == LinearStepConfigureMCP
}

// SelectedTeam returns the currently selected team
func (ls LinearSetup) SelectedTeam() *linear.Team {
	if ls.TeamIdx < len(ls.Teams) {
		return &ls.Teams[ls.TeamIdx]
	}
	return nil
}

// --- Views ---

// View renders the current Linear setup view
func (ls LinearSetup) View(spinnerIndex int) string {
	ls.SpinnerIndex = spinnerIndex

	switch ls.Step {
	case LinearStepNeedAPIKey:
		return ls.apiKeyView()
	case LinearStepSelectTeam:
		return ls.teamSelectView()
	case LinearStepNeedMCP:
		return ls.mcpAuthView()
	case LinearStepValidatingKey, LinearStepCheckMCP, LinearStepFetchTeams, LinearStepConfigureMCP:
		return ls.loadingView()
	default:
		return ""
	}
}

func (ls LinearSetup) loadingView() string {
	cliveLogo := lipgloss.NewStyle().
		Foreground(ColorRed).
		Bold(true).
		Render("CLIVE")

	subtitle := lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render(" · Linear Setup")

	var content strings.Builder
	content.WriteString(cliveLogo + subtitle)
	content.WriteString("\n\n")

	spinner := spinnerFrames[ls.SpinnerIndex%len(spinnerFrames)]
	var statusText string
	switch ls.Step {
	case LinearStepValidatingKey:
		statusText = "Validating API key..."
	case LinearStepCheckMCP:
		statusText = "Checking MCP authentication..."
	case LinearStepFetchTeams:
		statusText = "Fetching teams..."
	default:
		statusText = "Loading..."
	}

	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorYellow).
		Render(spinner + " " + statusText))

	selectionBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorBorder).
		Padding(1, 2).
		Render(content.String())

	return lipgloss.Place(
		ls.Width,
		ls.Height,
		lipgloss.Center,
		lipgloss.Center,
		selectionBox,
	)
}

func (ls LinearSetup) apiKeyView() string {
	cliveLogo := lipgloss.NewStyle().
		Foreground(ColorRed).
		Bold(true).
		Render("CLIVE")

	subtitle := lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render(" · Linear Setup (Step 1/2)")

	var content strings.Builder
	content.WriteString(cliveLogo + subtitle)
	content.WriteString("\n\n")

	// Title
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorBlue).
		Bold(true).
		Render("Enter Linear API Key (for this project)"))
	content.WriteString("\n\n")

	// Per-project note
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Italic(true).
		Render("Note: Auth credentials are saved globally and reused across projects"))
	content.WriteString("\n\n")

	// Show error if any
	if ls.Error != "" {
		content.WriteString(lipgloss.NewStyle().
			Foreground(ColorRed).
			Render("Warning: " + ls.Error))
		content.WriteString("\n\n")
	}

	// Instructions
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("Get your API key from Linear Settings > API:"))
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorBlue).
		Render("https://linear.app/settings/api"))
	content.WriteString("\n\n")

	// API key input
	inputBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorGreen).
		Padding(0, 1).
		Width(60).
		Render(ls.APIKeyInput.View())
	content.WriteString(inputBox)
	content.WriteString("\n\n")

	// Navigation hint
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("Enter to continue - Esc back - Ctrl+C quit"))

	selectionBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorBorder).
		Padding(1, 2).
		Render(content.String())

	return lipgloss.Place(
		ls.Width,
		ls.Height,
		lipgloss.Center,
		lipgloss.Center,
		selectionBox,
	)
}

func (ls LinearSetup) mcpAuthView() string {
	cliveLogo := lipgloss.NewStyle().
		Foreground(ColorRed).
		Bold(true).
		Render("CLIVE")

	subtitle := lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render(" · Linear Setup (Step 2/2)")

	var content strings.Builder
	content.WriteString(cliveLogo + subtitle)
	content.WriteString("\n\n")

	// Title
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorBlue).
		Bold(true).
		Render("Connect Linear MCP for Builder Agent"))
	content.WriteString("\n\n")

	// Show selected team
	if len(ls.Teams) > 0 && ls.TeamIdx < len(ls.Teams) {
		team := ls.Teams[ls.TeamIdx]
		content.WriteString(lipgloss.NewStyle().
			Foreground(ColorGreen).
			Render("Checkmark: API Key validated - Team: " + team.Name + " (" + team.Key + ")"))
		content.WriteString("\n\n")
	}

	// Show error if any
	if ls.Error != "" {
		content.WriteString(lipgloss.NewStyle().
			Foreground(ColorRed).
			Render("Warning: " + ls.Error))
		content.WriteString("\n\n")
	}

	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgPrimary).
		Render("The builder agent needs Linear MCP for issue updates."))
	content.WriteString("\n\n")

	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("This will open Claude Code. To authenticate:"))
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("  1. Type /mcp and select Linear"))
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("  2. Select \"Authenticate\""))
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("  3. Complete OAuth in your browser"))
	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("  4. Type /exit to return to Clive"))
	content.WriteString("\n\n")

	// Auth button
	buttonStyle := lipgloss.NewStyle().
		Background(ColorBlue).
		Foreground(lipgloss.Color("#ffffff")).
		Bold(true).
		Padding(0, 2)
	content.WriteString(buttonStyle.Render("> Open Claude Code"))
	content.WriteString("\n\n")

	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("Enter to continue - Esc back - Ctrl+C quit"))

	selectionBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorBorder).
		Padding(1, 2).
		Render(content.String())

	return lipgloss.Place(
		ls.Width,
		ls.Height,
		lipgloss.Center,
		lipgloss.Center,
		selectionBox,
	)
}

func (ls LinearSetup) teamSelectView() string {
	cliveLogo := lipgloss.NewStyle().
		Foreground(ColorRed).
		Bold(true).
		Render("CLIVE")

	subtitle := lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render(" · Select Linear Team")

	var content strings.Builder
	content.WriteString(cliveLogo + subtitle)
	content.WriteString("\n\n")

	// Per-project configuration note
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Italic(true).
		Render("Selecting a team for this project only (won't affect other repos)"))
	content.WriteString("\n\n")

	for i, team := range ls.Teams {
		var line string
		if i == ls.TeamIdx {
			// Selected item
			line = lipgloss.NewStyle().
				Background(ColorBgHighlight).
				Foreground(ColorFgPrimary).
				Bold(true).
				Padding(0, 1).
				Render("> " + team.Name)
		} else {
			line = lipgloss.NewStyle().
				Foreground(ColorFgPrimary).
				Padding(0, 1).
				Render("  " + team.Name)
		}

		// Add team key
		keyStyle := lipgloss.NewStyle().
			Foreground(ColorFgMuted).
			Render(" (" + team.Key + ")")

		content.WriteString(line + keyStyle)
		content.WriteString("\n")
	}

	content.WriteString("\n")
	content.WriteString(lipgloss.NewStyle().
		Foreground(ColorFgMuted).
		Render("Up/Down navigate - Enter select - Esc back - q quit"))

	selectionBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorBorder).
		Padding(1, 2).
		Render(content.String())

	return lipgloss.Place(
		ls.Width,
		ls.Height,
		lipgloss.Center,
		lipgloss.Center,
		selectionBox,
	)
}
