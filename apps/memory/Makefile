.PHONY: build build-mcp run test clean docker-up docker-down docker-build setup install-mcp

# Go build
BUILD_TAGS := -tags sqlite_fts5

build:
	CGO_ENABLED=1 go build $(BUILD_TAGS) -o bin/memory-server ./cmd/server

build-mcp:
	CGO_ENABLED=1 go build $(BUILD_TAGS) -o bin/memory-mcp ./cmd/mcp

run: build
	MEMORY_DB_PATH=./data/memory.db \
	OLLAMA_BASE_URL=http://localhost:11434 \
	QDRANT_URL=http://localhost:6333 \
	PORT=8741 \
	LOG_LEVEL=debug \
	./bin/memory-server

test:
	CGO_ENABLED=1 go test $(BUILD_TAGS) ./... -v

test-short:
	CGO_ENABLED=1 go test $(BUILD_TAGS) ./... -v -short

clean:
	rm -rf bin/ data/

# Docker
docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f memory

# Setup
setup:
	./scripts/setup.sh

# MCP
install-mcp: build-mcp
	./scripts/install-mcp.sh

# Formatting
fmt:
	go fmt ./...

vet:
	go vet ./...
