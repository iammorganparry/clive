package main

import (
	"fmt"
	"os"

	"github.com/anthropics/clive/apps/memory/internal/mcp"
)

func main() {
	serverURL := os.Getenv("MEMORY_SERVER_URL")
	if serverURL == "" {
		serverURL = "http://localhost:8741"
	}

	server := mcp.NewServer(serverURL)
	if err := server.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "mcp server error: %s\n", err)
		os.Exit(1)
	}
}
