package threads

import (
	"crypto/sha256"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/iammorganparry/clive/apps/memory/internal/models"
	"github.com/iammorganparry/clive/apps/memory/internal/store"
)

const (
	defaultTokenBudget = 4000
	totalBudgetCap     = 6000
	stalenessWarningDays = 7
)

// Service handles feature thread business logic.
type Service struct {
	threadStore    *store.ThreadStore
	memoryStore    *store.MemoryStore
	workspaceStore *store.WorkspaceStore
	logger         *slog.Logger
}

func NewService(
	threadStore *store.ThreadStore,
	memoryStore *store.MemoryStore,
	workspaceStore *store.WorkspaceStore,
	logger *slog.Logger,
) *Service {
	return &Service{
		threadStore:    threadStore,
		memoryStore:    memoryStore,
		workspaceStore: workspaceStore,
		logger:         logger,
	}
}

// Create creates a new feature thread.
func (s *Service) Create(req *models.CreateThreadRequest) (*models.FeatureThread, error) {
	workspaceID, err := s.workspaceStore.EnsureWorkspace(req.Namespace, req.Workspace)
	if err != nil {
		return nil, fmt.Errorf("ensure workspace: %w", err)
	}

	// Check for duplicate name
	existing, err := s.threadStore.GetThreadByName(workspaceID, req.Name)
	if err != nil {
		return nil, fmt.Errorf("check existing thread: %w", err)
	}
	if existing != nil {
		if existing.Status == models.ThreadStatusActive || existing.Status == models.ThreadStatusPaused {
			return nil, fmt.Errorf("thread with name %q already exists (status: %s)", req.Name, existing.Status)
		}
	}

	budget := req.TokenBudget
	if budget <= 0 {
		budget = defaultTokenBudget
	}

	now := time.Now().Unix()
	thread := &models.FeatureThread{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Description: req.Description,
		Status:      models.ThreadStatusActive,
		CreatedAt:   now,
		UpdatedAt:   now,
		TokenBudget: budget,
		Tags:        req.Tags,
	}

	if err := s.threadStore.CreateThread(thread); err != nil {
		return nil, fmt.Errorf("create thread: %w", err)
	}

	s.logger.Info("thread created", "id", thread.ID, "name", thread.Name)
	return thread, nil
}

// Get returns a thread with all its entries.
func (s *Service) Get(id string) (*models.ThreadWithEntries, error) {
	thread, err := s.threadStore.GetThread(id)
	if err != nil {
		return nil, fmt.Errorf("get thread: %w", err)
	}
	if thread == nil {
		return nil, nil
	}

	entries, err := s.threadStore.GetEntries(id)
	if err != nil {
		return nil, fmt.Errorf("get entries: %w", err)
	}
	if entries == nil {
		entries = []models.ThreadEntry{}
	}

	return &models.ThreadWithEntries{
		FeatureThread: *thread,
		Entries:       entries,
	}, nil
}

// List returns threads filtered by workspace, status, and name.
func (s *Service) List(req *models.ListThreadsRequest) ([]*models.FeatureThread, error) {
	workspaceID := ""
	if req.Workspace != "" {
		workspaceID = store.WorkspaceID(req.Namespace, req.Workspace)
	}
	return s.threadStore.ListThreads(workspaceID, req.Status, req.Name)
}

// Update applies partial updates to a thread.
func (s *Service) Update(id string, req *models.UpdateThreadRequest) (*models.FeatureThread, error) {
	return s.threadStore.UpdateThread(id, req)
}

// Delete removes a thread.
func (s *Service) Delete(id string) error {
	return s.threadStore.DeleteThread(id)
}

// AppendEntry creates a memory and links it to the thread as an entry.
func (s *Service) AppendEntry(threadID string, req *models.AppendEntryRequest) (*models.ThreadEntry, error) {
	thread, err := s.threadStore.GetThread(threadID)
	if err != nil {
		return nil, fmt.Errorf("get thread: %w", err)
	}
	if thread == nil {
		return nil, fmt.Errorf("thread not found: %s", threadID)
	}
	if thread.Status == models.ThreadStatusClosed {
		return nil, fmt.Errorf("cannot append to closed thread")
	}

	// Resolve workspace
	workspaceID := thread.WorkspaceID
	if req.Workspace != "" {
		workspaceID = store.WorkspaceID(req.Namespace, req.Workspace)
	}

	// Default memory type
	memType := req.MemoryType
	if memType == "" {
		memType = models.MemoryTypeContext
	}

	// Default confidence
	confidence := req.Confidence
	if confidence <= 0 {
		confidence = 0.8
	}

	// Default section
	section := req.Section
	if section == "" {
		section = models.ThreadSectionContext
	}

	// Create the memory
	now := time.Now().Unix()
	contentHash := fmt.Sprintf("%x", sha256.Sum256([]byte(req.Content)))

	// Merge thread tags with entry tags
	tags := req.Tags
	tags = append(tags, "thread:"+thread.Name)

	// Build initial stability from memory type
	stability := models.InitialStability[memType]
	if stability == 0 {
		stability = 5.0
	}

	memoryID := uuid.New().String()
	ttlHours := int64(72)
	expiresAt := now + ttlHours*3600

	mem := &models.Memory{
		ID:          memoryID,
		WorkspaceID: workspaceID,
		Content:     req.Content,
		MemoryType:  memType,
		Tier:        models.TierShort,
		Confidence:  confidence,
		Tags:        tags,
		Source:      "thread",
		ContentHash: contentHash,
		CreatedAt:   now,
		UpdatedAt:   now,
		ExpiresAt:   &expiresAt,
		Stability:   stability,
		ThreadID:    &threadID,
	}

	if err := s.memoryStore.Insert(mem); err != nil {
		return nil, fmt.Errorf("insert memory: %w", err)
	}

	// Get next sequence
	seq, err := s.threadStore.NextSequence(threadID)
	if err != nil {
		return nil, fmt.Errorf("get next sequence: %w", err)
	}

	entry := &models.ThreadEntry{
		ID:        uuid.New().String(),
		ThreadID:  threadID,
		MemoryID:  memoryID,
		Sequence:  seq,
		Section:   section,
		CreatedAt: now,
		Content:   req.Content,
		MemoryType: memType,
	}

	if err := s.threadStore.AppendEntry(entry); err != nil {
		return nil, fmt.Errorf("append entry: %w", err)
	}

	return entry, nil
}

// Close closes a thread. If distill is true, it creates permanent APP_KNOWLEDGE
// memories from decisions, findings, and architecture entries.
func (s *Service) Close(id string, distill bool) (*models.CloseThreadResponse, error) {
	thread, err := s.threadStore.GetThread(id)
	if err != nil {
		return nil, fmt.Errorf("get thread: %w", err)
	}
	if thread == nil {
		return nil, fmt.Errorf("thread not found: %s", id)
	}

	var distilledIDs []string

	if distill {
		distilledIDs, err = s.distillThread(thread)
		if err != nil {
			s.logger.Error("distillation failed", "thread", id, "error", err)
			// Don't fail the close operation
		}
	}

	// Mark as closed
	closedStatus := models.ThreadStatusClosed
	_, err = s.threadStore.UpdateThread(id, &models.UpdateThreadRequest{
		Status: &closedStatus,
	})
	if err != nil {
		return nil, fmt.Errorf("close thread: %w", err)
	}

	return &models.CloseThreadResponse{
		ThreadID:          id,
		Status:            string(models.ThreadStatusClosed),
		DistilledMemories: distilledIDs,
	}, nil
}

// distillThread creates permanent memories from valuable thread entries.
func (s *Service) distillThread(thread *models.FeatureThread) ([]string, error) {
	// Sections to distill (context and todo are transient)
	distillSections := []models.ThreadSection{
		models.ThreadSectionDecisions,
		models.ThreadSectionFindings,
		models.ThreadSectionArchitect,
	}

	var distilledIDs []string

	for _, section := range distillSections {
		entries, err := s.threadStore.GetEntriesBySection(thread.ID, section)
		if err != nil {
			continue
		}
		if len(entries) == 0 {
			continue
		}

		// Combine entries into a single APP_KNOWLEDGE memory per section
		var parts []string
		for _, e := range entries {
			parts = append(parts, e.Content)
		}
		content := fmt.Sprintf("[Thread: %s] [%s] %s", thread.Name, section, strings.Join(parts, " | "))

		now := time.Now().Unix()
		contentHash := fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
		memID := uuid.New().String()

		mem := &models.Memory{
			ID:          memID,
			WorkspaceID: thread.WorkspaceID,
			Content:     content,
			MemoryType:  models.MemoryTypeAppKnowledge,
			Tier:        models.TierLong,
			Confidence:  0.9,
			Tags:        append(thread.Tags, "thread:"+thread.Name, "distilled", string(section)),
			Source:      "thread-distill",
			ContentHash: contentHash,
			CreatedAt:   now,
			UpdatedAt:   now,
			Stability:   30.0,
		}

		if err := s.memoryStore.Insert(mem); err != nil {
			s.logger.Error("failed to distill entry", "section", section, "error", err)
			continue
		}
		distilledIDs = append(distilledIDs, memID)
	}

	return distilledIDs, nil
}

// GetContext generates pre-formatted XML context for a single thread.
func (s *Service) GetContext(id string) (string, error) {
	thread, err := s.threadStore.GetThread(id)
	if err != nil {
		return "", fmt.Errorf("get thread: %w", err)
	}
	if thread == nil {
		return "", fmt.Errorf("thread not found: %s", id)
	}

	entries, err := s.threadStore.GetEntries(id)
	if err != nil {
		return "", fmt.Errorf("get entries: %w", err)
	}

	return s.formatThreadContext(thread, entries, thread.TokenBudget), nil
}

// GetActiveContext generates pre-formatted XML context for all active threads in a workspace.
// If branch is provided, the matching thread is rendered first with a larger budget share.
func (s *Service) GetActiveContext(namespace, workspace, branch string) (string, error) {
	workspaceID := ""
	if workspace != "" {
		workspaceID = store.WorkspaceID(namespace, workspace)
	}

	threads, err := s.threadStore.ListThreads(workspaceID, models.ThreadStatusActive, "")
	if err != nil {
		return "", fmt.Errorf("list active threads: %w", err)
	}

	if len(threads) == 0 {
		return "", nil
	}

	// Separate branch-matching thread from the rest
	var branchThread *models.FeatureThread
	var otherThreads []*models.FeatureThread
	for _, t := range threads {
		if branch != "" && t.Name == branch {
			branchThread = t
		} else {
			otherThreads = append(otherThreads, t)
		}
	}

	// Budget allocation: branch thread gets 70% if others exist, 100% if alone
	branchBudget := totalBudgetCap
	otherBudget := 0
	if branchThread != nil && len(otherThreads) > 0 {
		branchBudget = totalBudgetCap * 70 / 100
		otherBudget = (totalBudgetCap - branchBudget) / len(otherThreads)
	} else if branchThread == nil && len(otherThreads) > 0 {
		otherBudget = totalBudgetCap / len(otherThreads)
	}

	var sb strings.Builder
	sb.WriteString(`<active-feature-threads>
IMPORTANT: You have active feature threads from prior sessions. This is your accumulated
working knowledge. You MUST read this context before doing any work. Do NOT re-explore
code or re-make decisions already documented here.
`)

	if branch != "" {
		sb.WriteString(fmt.Sprintf("\nCurrent branch: %s", branch))
		if branchThread != nil {
			sb.WriteString(fmt.Sprintf(" (matched thread: %s)", branchThread.Name))
		}
		sb.WriteString("\n")
	}

	// Render branch-matching thread first (highest priority)
	if branchThread != nil {
		entries, err := s.threadStore.GetEntries(branchThread.ID)
		if err != nil {
			s.logger.Error("failed to get entries for branch thread", "thread", branchThread.ID, "error", err)
		} else {
			sb.WriteString("\n")
			sb.WriteString(s.formatThreadContext(branchThread, entries, branchBudget))
		}
	}

	// Render other active threads
	for _, thread := range otherThreads {
		entries, err := s.threadStore.GetEntries(thread.ID)
		if err != nil {
			s.logger.Error("failed to get entries for thread", "thread", thread.ID, "error", err)
			continue
		}
		sb.WriteString("\n")
		sb.WriteString(s.formatThreadContext(thread, entries, otherBudget))
	}

	sb.WriteString("\n</active-feature-threads>")
	return sb.String(), nil
}

// formatThreadContext renders a single thread as XML with budget constraints.
func (s *Service) formatThreadContext(thread *models.FeatureThread, entries []models.ThreadEntry, budget int) string {
	var sb strings.Builder

	// Staleness warning
	daysSinceUpdate := (time.Now().Unix() - thread.UpdatedAt) / 86400
	staleAttr := ""
	if daysSinceUpdate >= stalenessWarningDays {
		staleAttr = fmt.Sprintf(` stale="true" days-since-update="%d"`, daysSinceUpdate)
	}

	lastUpdated := time.Unix(thread.UpdatedAt, 0).Format("2006-01-02")
	sb.WriteString(fmt.Sprintf(`<feature-thread name="%s" status="%s" entries="%d" last-updated="%s"%s>`,
		thread.Name, thread.Status, thread.EntryCount, lastUpdated, staleAttr))

	usedTokens := 0

	// 1. Always include summary (highest priority)
	if thread.Summary != "" {
		summaryXML := fmt.Sprintf("\n  <thread-summary>%s</thread-summary>", thread.Summary)
		usedTokens += estimateTokens(summaryXML)
		sb.WriteString(summaryXML)
	}

	// Group entries by section
	bySection := make(map[models.ThreadSection][]models.ThreadEntry)
	for _, e := range entries {
		bySection[e.Section] = append(bySection[e.Section], e)
	}

	// 2. Priority order: todo > decisions > architecture > findings > context
	sectionOrder := []models.ThreadSection{
		models.ThreadSectionTodo,
		models.ThreadSectionDecisions,
		models.ThreadSectionArchitect,
		models.ThreadSectionFindings,
		models.ThreadSectionContext,
	}

	for _, section := range sectionOrder {
		sectionEntries, ok := bySection[section]
		if !ok || len(sectionEntries) == 0 {
			continue
		}

		sectionXML := s.formatSection(section, sectionEntries, budget-usedTokens)
		if sectionXML == "" {
			continue
		}

		sectionTokens := estimateTokens(sectionXML)
		if usedTokens+sectionTokens > budget {
			// Include truncation marker
			remaining := 0
			for _, sec := range sectionOrder {
				if entries, ok := bySection[sec]; ok {
					remaining += len(entries)
				}
			}
			sb.WriteString(fmt.Sprintf("\n  <truncated remaining=\"%d\" />", remaining))
			break
		}

		usedTokens += sectionTokens
		sb.WriteString(sectionXML)
	}

	sb.WriteString("\n</feature-thread>")
	return sb.String()
}

// formatSection renders entries for a section, respecting the remaining token budget.
func (s *Service) formatSection(section models.ThreadSection, entries []models.ThreadEntry, remainingBudget int) string {
	if remainingBudget <= 0 || len(entries) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("\n  <thread-section name=\"%s\">", section))

	usedTokens := 0
	included := 0

	// For recent-first priority, reverse the entries (most recent last in sequence, show from end)
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		entryXML := fmt.Sprintf("\n    <entry seq=\"%d\">%s</entry>", e.Sequence, e.Content)
		entryTokens := estimateTokens(entryXML)

		if usedTokens+entryTokens > remainingBudget {
			remaining := i + 1
			sb.WriteString(fmt.Sprintf("\n    <truncated remaining=\"%d\" />", remaining))
			break
		}

		usedTokens += entryTokens
		sb.WriteString(entryXML)
		included++
	}

	if included == 0 {
		return ""
	}

	sb.WriteString("\n  </thread-section>")
	return sb.String()
}

// estimateTokens uses the conservative heuristic: len(text) / 4.
func estimateTokens(text string) int {
	return len(text) / 4
}
