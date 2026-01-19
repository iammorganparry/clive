.PHONY: build run test clean dev install

# Binary name for local build (dev only)
# NOTE: When installing to PATH, the binary should be named "clive" (not "clive-tui")
# The cmd directory is named clive-tui for historical reasons, but the installed binary is "clive"
LOCAL_BINARY := bin/clive-tui
INSTALL_PATH := $(HOME)/bin/clive

# Build the binary (local dev)
build:
	go build -o $(LOCAL_BINARY) ./cmd/clive-tui

# Install to user's bin directory as "clive"
# IMPORTANT: The installed binary name is "clive", not "clive-tui"
install:
	@mkdir -p $(HOME)/bin
	go build -o $(INSTALL_PATH) ./cmd/clive-tui
	@echo "Installed to $(INSTALL_PATH)"

# Run the binary
run: build
	./bin/clive-tui

# Run in development mode (with hot reload using air if installed)
dev:
	@if command -v air > /dev/null; then \
		air; \
	else \
		echo "air not installed. Run: go install github.com/cosmtrek/air@latest"; \
		echo "Running without hot reload..."; \
		$(MAKE) run; \
	fi

# Run tests
test:
	go test ./...

# Clean build artifacts
clean:
	rm -rf bin/

# Install dependencies
deps:
	go mod tidy

# Format code
fmt:
	go fmt ./...

# Lint code
lint:
	@if command -v golangci-lint > /dev/null; then \
		golangci-lint run; \
	else \
		echo "golangci-lint not installed. Run: brew install golangci-lint"; \
	fi
