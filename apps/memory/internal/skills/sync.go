package skills

import (
	"fmt"
	"log/slog"

	"github.com/iammorganparry/clive/apps/memory/internal/memory"
	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
	"github.com/iammorganparry/clive/apps/memory/internal/vectorstore"
)

// SyncResult reports what happened during a skill sync.
type SyncResult struct {
	Found  int `json:"found"`
	Stored int `json:"stored"`
	Errors int `json:"errors"`
}

// SyncService scans skill directories and stores skill descriptions
// as SKILL_HINT memories in the global workspace.
type SyncService struct {
	svc          *memory.Service
	memoryStore  *store.MemoryStore
	qdrantClient *vectorstore.QdrantClient
	dirs         []string
	logger       *slog.Logger
}

// NewSyncService creates a new SyncService.
func NewSyncService(
	svc *memory.Service,
	memoryStore *store.MemoryStore,
	qdrantClient *vectorstore.QdrantClient,
	dirs []string,
	logger *slog.Logger,
) *SyncService {
	return &SyncService{
		svc:          svc,
		memoryStore:  memoryStore,
		qdrantClient: qdrantClient,
		dirs:         dirs,
		logger:       logger,
	}
}

// Sync scans skill directories, removes old SKILL_HINT memories,
// and stores fresh ones. This is idempotent.
func (s *SyncService) Sync() (*SyncResult, error) {
	return s.SyncDirs(s.dirs)
}

// SyncDirs runs sync for specific directories (used by API override).
func (s *SyncService) SyncDirs(dirs []string) (*SyncResult, error) {
	skills, err := ScanSkills(dirs)
	if err != nil {
		return nil, fmt.Errorf("scan skills: %w", err)
	}

	result := &SyncResult{Found: len(skills)}

	// Delete all existing SKILL_HINT memories from the global workspace
	deletedIDs, err := s.memoryStore.DeleteByTypeAndWorkspace(
		string(models.MemoryTypeSkillHint),
		models.GlobalWorkspaceID,
	)
	if err != nil {
		s.logger.Warn("failed to delete old skill hints", "error", err)
	}

	// Clean up Qdrant points for deleted memories
	if len(deletedIDs) > 0 {
		colName := vectorstore.CollectionName(models.GlobalWorkspaceID)
		if err := s.qdrantClient.DeletePoints(colName, deletedIDs); err != nil {
			s.logger.Warn("failed to clean qdrant points", "error", err)
		}
	}

	// Store each skill as a SKILL_HINT memory
	for _, skill := range skills {
		content := fmt.Sprintf("[Skill: %s] %s", skill.Name, skill.Description)
		tags := []string{"skill", fmt.Sprintf("skill:%s", skill.Name)}

		req := &models.StoreRequest{
			Content:    content,
			MemoryType: models.MemoryTypeSkillHint,
			Tier:       models.TierLong,
			Confidence: 1.0,
			Tags:       tags,
			Source:     "skill-sync",
			Global:     true,
		}

		_, err := s.svc.Store(req)
		if err != nil {
			s.logger.Error("failed to store skill hint",
				"skill", skill.Name,
				"error", err,
			)
			result.Errors++
			continue
		}

		result.Stored++
	}

	return result, nil
}

// ListSkills returns the currently scannable skills (without syncing).
func (s *SyncService) ListSkills() ([]SkillMeta, error) {
	return ScanSkills(s.dirs)
}
