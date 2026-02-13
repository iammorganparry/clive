package main

import (
	"fmt"
	"os"

	"github.com/iammorganparry/clive/apps/memory/internal/mcp"
)

func main() {
	serverURL := os.Getenv("MEMORY_SERVER_URL")
	if serverURL == "" {
		serverURL = "http://localhost:8741"
	}

	namespace := os.Getenv("CLIVE_NAMESPACE")

	server := mcp.NewServer(serverURL, namespace)
	if err := server.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "mcp server error: %s\n", err)
		os.Exit(1)
	}
}
