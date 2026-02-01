# Build stage
FROM golang:1.24-alpine AS builder
RUN apk add --no-cache gcc musl-dev sqlite-dev
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 go build -tags sqlite_fts5 -o /memory-server ./cmd/server

# Runtime stage
FROM alpine:3.20
RUN apk add --no-cache sqlite-libs curl ca-certificates
COPY --from=builder /memory-server /usr/local/bin/memory-server
RUN mkdir -p /data
ENV MEMORY_DB_PATH=/data/memory.db
ENV OLLAMA_BASE_URL=http://ollama:11434
ENV QDRANT_URL=http://qdrant:6333
ENV PORT=8741
EXPOSE 8741
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8741/health || exit 1
ENTRYPOINT ["memory-server"]
