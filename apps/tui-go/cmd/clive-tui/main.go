package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/clive/tui-go/internal/config"
	"github.com/clive/tui-go/internal/setup"
	"github.com/clive/tui-go/internal/tui"
)

func main() {
	// Parse command line flags
	debugMode := flag.Bool("debug", false, "Enable debug panel showing raw events")
	flag.Parse()

	// Ensure Linear MCP is configured for this project
	if configured, err := setup.EnsureLinearMcpConfigured(); err != nil {
		log.Printf("Warning: Failed to configure Linear MCP: %v\n", err)
	} else if configured {
		fmt.Fprintln(os.Stderr, "✓ Configured Linear MCP for this project")
	}

	// Load config (nil if doesn't exist - will show setup screen)
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		os.Exit(1)
	}

	p := tea.NewProgram(
		tui.NewRootModelWithOptions(cfg, tui.ModelOptions{DebugMode: *debugMode}),
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running program: %v\n", err)
		os.Exit(1)
	}
}
