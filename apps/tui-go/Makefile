.PHONY: build run test clean dev

# Build the binary
build:
	go build -o bin/clive-tui ./cmd/clive-tui

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
