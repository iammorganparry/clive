package vectorstore

import (
	"fmt"
	"sync"
)

const collectionPrefix = "clive_memory_"

// CollectionManager maps workspace IDs to Qdrant collections and ensures
// they are created on first use.
type CollectionManager struct {
	client  *QdrantClient
	known   map[string]bool
	mu      sync.RWMutex
}

func NewCollectionManager(client *QdrantClient) *CollectionManager {
	return &CollectionManager{
		client: client,
		known:  make(map[string]bool),
	}
}

// CollectionName returns the Qdrant collection name for a workspace ID.
func CollectionName(workspaceID string) string {
	return collectionPrefix + workspaceID
}

// EnsureForWorkspace creates the Qdrant collection for a workspace if it
// doesn't already exist. Results are cached in-memory.
func (m *CollectionManager) EnsureForWorkspace(workspaceID string) (string, error) {
	name := CollectionName(workspaceID)

	m.mu.RLock()
	if m.known[name] {
		m.mu.RUnlock()
		return name, nil
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()

	// Double-check after acquiring write lock
	if m.known[name] {
		return name, nil
	}

	if err := m.client.EnsureCollection(name); err != nil {
		return "", fmt.Errorf("ensure collection %s: %w", name, err)
	}

	m.known[name] = true
	return name, nil
}
