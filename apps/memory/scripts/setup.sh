#!/usr/bin/env bash
set -euo pipefail

echo "=== Clive Memory Server Setup ==="

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Install from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running. Please start Docker."
  exit 1
fi

echo "[1/3] Starting services via Docker Compose..."
docker compose up -d

echo "[2/3] Waiting for Ollama to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "  Ollama is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ERROR: Ollama did not become ready in time."
    exit 1
  fi
  sleep 2
done

echo "[3/3] Verifying model availability..."
if curl -sf http://localhost:11434/api/tags | grep -q "nomic-embed-text"; then
  echo "  nomic-embed-text model is available."
else
  echo "  Pulling nomic-embed-text model (this may take a few minutes)..."
  docker exec clive-ollama ollama pull nomic-embed-text
fi

echo ""
echo "=== Setup complete ==="
echo "Memory server: http://localhost:8741"
echo "Qdrant:        http://localhost:6333"
echo "Ollama:        http://localhost:11434"
echo ""
echo "Test with: curl http://localhost:8741/health"
