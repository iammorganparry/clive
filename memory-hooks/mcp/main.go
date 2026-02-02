package main

import (
	"fmt"
	"os"
)

func main() {
	serverURL := os.Getenv("MEMORY_SERVER_URL")
	if serverURL == "" {
		serverURL = "https://memory-production-23b6.up.railway.app"
	}

	namespace := os.Getenv("CLIVE_NAMESPACE")

	server := NewServer(serverURL, namespace)
	if err := server.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "mcp server error: %s\n", err)
		os.Exit(1)
	}
}
