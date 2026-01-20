.PHONY: build run test clean dev install

# Binary name for local build (dev only)
# NOTE: When installing to PATH, the binary should be named "clive" (not "clive-tui")
# The cmd directory is named clive-tui for historical reasons, but the installed binary is "clive"
LOCAL_BINARY := bin/clive
INSTALL_PATH := $(HOME)/bin/clive-tui

# Get version from git commit SHA
VERSION := $(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")
LDFLAGS := -X github.com/clive/tui-go/internal/tui.Version=$(VERSION)

# Build the binary (local dev) with version injection
build:
	@echo "Building clive (version: $(VERSION))..."
	@mkdir -p bin
	go build -ldflags "$(LDFLAGS)" -o $(LOCAL_BINARY) ./cmd/clive-tui
	@echo "✓ Built: $(LOCAL_BINARY) (v$(VERSION))"

# Install to user's bin directory as "clive-tui"
install:
	@echo "Installing clive-tui (version: $(VERSION))..."
	@mkdir -p $(HOME)/bin
	go build -ldflags "$(LDFLAGS)" -o $(INSTALL_PATH) ./cmd/clive-tui
	@echo "✓ Installed to $(INSTALL_PATH) (v$(VERSION))"

# Run the binary
run: build
	./$(LOCAL_BINARY)

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
