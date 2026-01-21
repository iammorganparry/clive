package tui

import "github.com/charmbracelet/lipgloss"

// One Dark Pro color palette
var (
	// Background colors
	ColorBgPrimary   = lipgloss.Color("#282C34")
	ColorBgSecondary = lipgloss.Color("#21252B")
	ColorBgHighlight = lipgloss.Color("#2C313C")

	// Foreground colors
	ColorFgPrimary   = lipgloss.Color("#ABB2BF")
	ColorFgSecondary = lipgloss.Color("#828997")
	ColorFgMuted     = lipgloss.Color("#636B78")
	ColorFgComment   = lipgloss.Color("#5C6370")

	// Syntax colors
	ColorRed     = lipgloss.Color("#E06C75")
	ColorGreen   = lipgloss.Color("#98C379")
	ColorYellow  = lipgloss.Color("#E5C07B")
	ColorBlue    = lipgloss.Color("#61AFEF")
	ColorMagenta = lipgloss.Color("#C678DD")
	ColorCyan    = lipgloss.Color("#56B6C2")
	ColorOrange  = lipgloss.Color("#D19A66")

	// UI colors
	ColorBorder = lipgloss.Color("#3F4451")
)

// Component styles
var (
	// Header style
	HeaderStyle = lipgloss.NewStyle().
			Foreground(ColorRed).
			Bold(true).
			PaddingLeft(1)

	// Sidebar styles
	SidebarStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorBorder).
			Padding(0, 1)

	SidebarTitleStyle = lipgloss.NewStyle().
				Foreground(ColorMagenta).
				Bold(true)

	// Output area styles
	OutputStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorBorder).
			Padding(1, 2)

	OutputHeaderStyle = lipgloss.NewStyle().
				Foreground(ColorMagenta).
				Bold(true)

	// Tool call styles
	ToolCallStyle = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder(), false, false, false, true).
			BorderForeground(ColorYellow).
			PaddingLeft(1)

	ToolNameStyle = lipgloss.NewStyle().
			Foreground(ColorYellow).
			Bold(false)

	ToolResultStyle = lipgloss.NewStyle().
			Foreground(ColorFgComment).
			MarginLeft(3)

	// Assistant response styles
	AssistantStyle = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder(), false, false, false, true).
			BorderForeground(ColorBlue).
			PaddingLeft(1).
			PaddingRight(1)

	// System message styles
	SystemStyle = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder(), false, false, false, true).
			BorderForeground(ColorMagenta).
			PaddingLeft(1)

	SystemTextStyle = lipgloss.NewStyle().
			Foreground(ColorCyan)

	// User input styles
	UserInputStyle = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder(), false, false, false, true).
			BorderForeground(ColorGreen).
			PaddingLeft(1).
			MarginTop(1).
			MarginBottom(1)

	UserTextStyle = lipgloss.NewStyle().
			Foreground(ColorGreen).
			Bold(true)

	// Status bar styles
	StatusBarStyle = lipgloss.NewStyle().
			Foreground(ColorFgMuted).
			PaddingLeft(1).
			PaddingRight(1)

	StatusRunningStyle = lipgloss.NewStyle().
				Foreground(ColorGreen).
				Bold(true)

	StatusIdleStyle = lipgloss.NewStyle().
			Foreground(ColorFgMuted)

	// Task item styles
	TaskPendingStyle = lipgloss.NewStyle().
				Foreground(ColorFgMuted)

	TaskInProgressStyle = lipgloss.NewStyle().
				Foreground(ColorYellow)

	TaskCompleteStyle = lipgloss.NewStyle().
				Foreground(ColorGreen)

	TaskBlockedStyle = lipgloss.NewStyle().
				Foreground(ColorRed)

	// Input styles
	InputStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorBorder).
			Padding(0, 1)

	InputPromptStyle = lipgloss.NewStyle().
				Foreground(ColorGreen)

	// Help overlay styles
	HelpStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorBorder).
			Padding(1, 2)

	HelpTitleStyle = lipgloss.NewStyle().
			Foreground(ColorBlue).
			Bold(true)

	HelpKeyStyle = lipgloss.NewStyle().
			Foreground(ColorYellow)

	HelpDescStyle = lipgloss.NewStyle().
			Foreground(ColorFgPrimary)

	// Error styles
	ErrorStyle = lipgloss.NewStyle().
			Foreground(ColorRed)

	// Success styles
	SuccessStyle = lipgloss.NewStyle().
			Foreground(ColorGreen)

	// Warning styles
	WarningStyle = lipgloss.NewStyle().
			Foreground(ColorYellow)

	// Dimmed/info style for less important messages
	DimStyle = lipgloss.NewStyle().
			Foreground(ColorFgComment)
)
