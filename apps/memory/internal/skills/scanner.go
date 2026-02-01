package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// SkillMeta holds parsed metadata from a SKILL.md frontmatter.
type SkillMeta struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Path        string `yaml:"-"` // absolute path to SKILL.md
}

// ScanSkills walks each directory in dirs looking for */SKILL.md files
// and parses their YAML frontmatter for name and description.
func ScanSkills(dirs []string) ([]SkillMeta, error) {
	var skills []SkillMeta

	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			// Skip directories that don't exist
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("read skill dir %s: %w", dir, err)
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}

			skillPath := filepath.Join(dir, entry.Name(), "SKILL.md")
			data, err := os.ReadFile(skillPath)
			if err != nil {
				// No SKILL.md in this subdirectory, skip
				continue
			}

			meta, err := parseFrontmatter(data)
			if err != nil {
				continue
			}

			if meta.Name == "" {
				// Use directory name as fallback
				meta.Name = entry.Name()
			}
			meta.Path = skillPath

			if meta.Description == "" {
				continue
			}

			skills = append(skills, meta)
		}
	}

	return skills, nil
}

// parseFrontmatter extracts YAML frontmatter from a SKILL.md file.
// Frontmatter is delimited by --- markers.
func parseFrontmatter(data []byte) (SkillMeta, error) {
	content := string(data)

	// Must start with ---
	if !strings.HasPrefix(strings.TrimSpace(content), "---") {
		return SkillMeta{}, fmt.Errorf("no frontmatter found")
	}

	// Find the closing ---
	trimmed := strings.TrimSpace(content)
	rest := trimmed[3:] // skip opening ---
	idx := strings.Index(rest, "\n---")
	if idx < 0 {
		return SkillMeta{}, fmt.Errorf("no closing frontmatter delimiter")
	}

	yamlBlock := rest[:idx]

	var meta SkillMeta
	if err := yaml.Unmarshal([]byte(yamlBlock), &meta); err != nil {
		return SkillMeta{}, fmt.Errorf("parse yaml: %w", err)
	}

	// Clean up multiline description (yaml > folded scalar may have trailing newline)
	meta.Description = strings.TrimSpace(meta.Description)

	return meta, nil
}
