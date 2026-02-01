package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

// DB wraps the SQLite connection with initialization logic.
type DB struct {
	*sql.DB
}

// Open creates or opens the SQLite database at the given path, runs schema
// initialization, and configures WAL mode for concurrent reads.
func Open(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_foreign_keys=ON")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(1) // SQLite handles one writer at a time

	if err := initSchema(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}

	if err := runMigrations(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	return &DB{db}, nil
}

// runMigrations applies incremental schema changes that were added after the
// initial schema. Each migration is idempotent so it is safe to call on every
// database open.
func runMigrations(db *sql.DB) error {
	// Check whether the impact_score column already exists on the memories table.
	hasImpactScore, err := columnExists(db, "memories", "impact_score")
	if err != nil {
		return fmt.Errorf("check impact_score column: %w", err)
	}

	if !hasImpactScore {
		migrations := []string{
			`ALTER TABLE memories ADD COLUMN impact_score REAL NOT NULL DEFAULT 0.0`,
			`ALTER TABLE memories ADD COLUMN related_files TEXT`,
			`CREATE TABLE IF NOT EXISTS memory_impacts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				memory_id TEXT NOT NULL,
				signal TEXT NOT NULL,
				source TEXT NOT NULL,
				session_id TEXT,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
			)`,
			`CREATE INDEX IF NOT EXISTS idx_memory_impacts_memory_id ON memory_impacts(memory_id)`,
			`CREATE INDEX IF NOT EXISTS idx_memories_impact_score ON memories(impact_score)`,
		}
		for _, m := range migrations {
			if _, err := db.Exec(m); err != nil {
				return fmt.Errorf("run migration v1: %w", err)
			}
		}
	}

	// --- Migration v2: Cognitive science features ---
	if err := runCogSciMigrations(db); err != nil {
		return err
	}

	// --- Migration v3: Sessions table ---
	if err := runSessionsMigration(db); err != nil {
		return err
	}

	// --- Migration v4: Observations table ---
	if err := runObservationsMigration(db); err != nil {
		return err
	}

	return nil
}

// runCogSciMigrations adds columns for forgetting curve, encoding specificity,
// interference management, spreading activation, and Zeigarnik effect.
func runCogSciMigrations(db *sql.DB) error {
	// Check if already applied by looking for the stability column.
	hasStability, err := columnExists(db, "memories", "stability")
	if err != nil {
		return fmt.Errorf("check stability column: %w", err)
	}

	if hasStability {
		// Ensure the memory_links table exists (may have been missed in a partial migration)
		linksTable := `CREATE TABLE IF NOT EXISTS memory_links (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id TEXT NOT NULL,
			target_id TEXT NOT NULL,
			link_type TEXT NOT NULL,
			strength REAL NOT NULL DEFAULT 1.0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
			FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE,
			UNIQUE(source_id, target_id, link_type)
		)`
		if _, err := db.Exec(linksTable); err != nil {
			return fmt.Errorf("ensure memory_links table: %w", err)
		}
		return nil
	}

	migrations := []string{
		// Feature 1: Forgetting Curve
		`ALTER TABLE memories ADD COLUMN stability REAL NOT NULL DEFAULT 5.0`,
		`ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER`,

		// Feature 2: Encoding Specificity
		`ALTER TABLE memories ADD COLUMN encoding_context TEXT`,

		// Feature 3: Interference Management
		`ALTER TABLE memories ADD COLUMN superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL`,
		`CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by)`,

		// Feature 4: Spreading Activation
		`CREATE TABLE IF NOT EXISTS memory_links (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id TEXT NOT NULL,
			target_id TEXT NOT NULL,
			link_type TEXT NOT NULL,
			strength REAL NOT NULL DEFAULT 1.0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
			FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE,
			UNIQUE(source_id, target_id, link_type)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id)`,
		`CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id)`,

		// Feature 5: Zeigarnik Effect
		`ALTER TABLE memories ADD COLUMN completion_status TEXT`,
		`CREATE INDEX IF NOT EXISTS idx_memories_completion ON memories(completion_status)`,
	}

	// Backfill last_accessed_at from updated_at
	migrations = append(migrations,
		`UPDATE memories SET last_accessed_at = updated_at WHERE last_accessed_at IS NULL`,
	)

	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return fmt.Errorf("run cognitive science migration: %w", err)
		}
	}

	return nil
}

// runSessionsMigration creates the sessions table (Migration v3).
func runSessionsMigration(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			started_at INTEGER NOT NULL,
			ended_at INTEGER,
			summary_memory_id TEXT,
			prompt_count INTEGER DEFAULT 0,
			FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
			FOREIGN KEY (summary_memory_id) REFERENCES memories(id) ON DELETE SET NULL
		)
	`)
	if err != nil {
		return fmt.Errorf("create sessions table: %w", err)
	}

	// Create indexes idempotently
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at)`,
	}
	for _, idx := range indexes {
		if _, err := db.Exec(idx); err != nil {
			return fmt.Errorf("create sessions index: %w", err)
		}
	}
	return nil
}

// runObservationsMigration creates the observations table (Migration v4).
func runObservationsMigration(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS observations (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			input TEXT,
			output TEXT,
			success INTEGER DEFAULT 1,
			created_at INTEGER NOT NULL,
			sequence INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return fmt.Errorf("create observations table: %w", err)
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id)`,
		`CREATE INDEX IF NOT EXISTS idx_observations_sequence ON observations(session_id, sequence)`,
	}
	for _, idx := range indexes {
		if _, err := db.Exec(idx); err != nil {
			return fmt.Errorf("create observations index: %w", err)
		}
	}
	return nil
}

func initSchema(db *sql.DB) error {
	schema := `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'short',
  confidence REAL NOT NULL DEFAULT 0.8,
  access_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  source TEXT,
  session_id TEXT,
  content_hash TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_workspace_tier ON memories(workspace_id, tier);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);

CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  dimension INTEGER NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`
	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("create tables: %w", err)
	}

	// FTS5 virtual table and triggers are created separately since
	// IF NOT EXISTS isn't always supported for virtual tables in older SQLite.
	fts := `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, memory_type, tags,
  content='memories', content_rowid='rowid'
);
`
	if _, err := db.Exec(fts); err != nil {
		return fmt.Errorf("create fts table: %w", err)
	}

	triggers := []string{
		`CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, memory_type, tags)
  VALUES (NEW.rowid, NEW.content, NEW.memory_type, NEW.tags);
END;`,
		`CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, memory_type, tags)
  VALUES ('delete', OLD.rowid, OLD.content, OLD.memory_type, OLD.tags);
END;`,
		`CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, memory_type, tags)
  VALUES ('delete', OLD.rowid, OLD.content, OLD.memory_type, OLD.tags);
  INSERT INTO memories_fts(rowid, content, memory_type, tags)
  VALUES (NEW.rowid, NEW.content, NEW.memory_type, NEW.tags);
END;`,
	}

	for _, t := range triggers {
		if _, err := db.Exec(t); err != nil {
			return fmt.Errorf("create trigger: %w", err)
		}
	}

	return nil
}

// MemoryCount returns the total number of memories in the database.
func (db *DB) MemoryCount() (int, error) {
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM memories").Scan(&count)
	return count, err
}

// columnExists checks if a column exists in a table. It properly closes the
// rows cursor before returning, avoiding deadlocks with MaxOpenConns(1).
func columnExists(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(
		fmt.Sprintf("SELECT name FROM pragma_table_info('%s') WHERE name = ?", table),
		column,
	)
	if err != nil {
		return false, err
	}
	found := rows.Next()
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, err
	}
	return found, nil
}
