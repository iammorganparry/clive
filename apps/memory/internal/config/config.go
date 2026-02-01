package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Port           int
	DBPath         string
	OllamaBaseURL  string
	QdrantURL      string
	EmbeddingModel string
	EmbeddingDim   int
	LogLevel       string
	// Search tuning
	VectorWeight      float64
	BM25Weight        float64
	LongTermBoost     float64
	DedupThreshold    float64
	DefaultMinScore   float64
	DefaultMaxResults int
	// Lifecycle
	ShortTermTTLHours   int
	PromotionAccessMin  int
	PromotionConfidence float64
	// Skills
	SkillDirs     []string
	SkillAutoSync bool
	// Session summarization
	SummaryModel   string
	SummaryEnabled bool
	// MCP adapter
	MemoryServerURL string
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:                envInt("PORT", 8741),
		DBPath:              envStr("MEMORY_DB_PATH", "/data/memory.db"),
		OllamaBaseURL:       envStr("OLLAMA_BASE_URL", "http://localhost:11434"),
		QdrantURL:           envStr("QDRANT_URL", "http://localhost:6333"),
		EmbeddingModel:      envStr("EMBEDDING_MODEL", "nomic-embed-text"),
		EmbeddingDim:        envInt("EMBEDDING_DIM", 768),
		LogLevel:            envStr("LOG_LEVEL", "info"),
		VectorWeight:        envFloat("VECTOR_WEIGHT", 0.7),
		BM25Weight:          envFloat("BM25_WEIGHT", 0.3),
		LongTermBoost:       envFloat("LONG_TERM_BOOST", 1.2),
		DedupThreshold:      envFloat("DEDUP_THRESHOLD", 0.92),
		DefaultMinScore:     envFloat("DEFAULT_MIN_SCORE", 0.3),
		DefaultMaxResults:   envInt("DEFAULT_MAX_RESULTS", 10),
		ShortTermTTLHours:   envInt("SHORT_TERM_TTL_HOURS", 72),
		PromotionAccessMin:  envInt("PROMOTION_ACCESS_MIN", 3),
		PromotionConfidence: envFloat("PROMOTION_CONFIDENCE_MIN", 0.85),
		SkillDirs:           envSkillDirs("SKILL_DIRS"),
		SkillAutoSync:       envBool("SKILL_AUTO_SYNC", true),
		SummaryModel:        envStr("SUMMARY_MODEL", "qwen2.5:1.5b"),
		SummaryEnabled:      envBool("SUMMARY_ENABLED", true),
		MemoryServerURL:     envStr("MEMORY_SERVER_URL", "http://localhost:8741"),
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("config validation: %w", err)
	}

	return cfg, nil
}

func (c *Config) validate() error {
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("PORT must be between 1 and 65535, got %d", c.Port)
	}
	if c.DBPath == "" {
		return fmt.Errorf("MEMORY_DB_PATH must not be empty")
	}
	if c.OllamaBaseURL == "" {
		return fmt.Errorf("OLLAMA_BASE_URL must not be empty")
	}
	if c.EmbeddingDim < 1 {
		return fmt.Errorf("EMBEDDING_DIM must be positive, got %d", c.EmbeddingDim)
	}
	sum := c.VectorWeight + c.BM25Weight
	if sum < 0.99 || sum > 1.01 {
		return fmt.Errorf("VECTOR_WEIGHT + BM25_WEIGHT must equal 1.0, got %f", sum)
	}
	return nil
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return fallback
}

func envSkillDirs(key string) []string {
	if v := os.Getenv(key); v != "" {
		parts := strings.Split(v, ",")
		var dirs []string
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				dirs = append(dirs, p)
			}
		}
		if len(dirs) > 0 {
			return dirs
		}
	}
	// Default: ~/.claude/skills
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	return []string{filepath.Join(home, ".claude", "skills")}
}
