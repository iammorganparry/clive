package skills

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseFrontmatter(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    SkillMeta
		wantErr bool
	}{
		{
			name: "simple frontmatter",
			input: `---
name: test-skill
description: A test skill description
---

# Test Skill
`,
			want: SkillMeta{
				Name:        "test-skill",
				Description: "A test skill description",
			},
		},
		{
			name: "folded scalar description",
			input: `---
name: seed-memory
description: >
  Extract learnings from Claude Code JSONL conversation transcripts and seed them
  into the Clive memory server. Use when the user says "seed memory".
---

# Seed Memory
`,
			want: SkillMeta{
				Name:        "seed-memory",
				Description: `Extract learnings from Claude Code JSONL conversation transcripts and seed them into the Clive memory server. Use when the user says "seed memory".`,
			},
		},
		{
			name: "with extra fields",
			input: `---
name: browser-use
description: Automates browser interactions for web testing.
allowed-tools: Bash(browser-use:*)
---

# Browser Use
`,
			want: SkillMeta{
				Name:        "browser-use",
				Description: "Automates browser interactions for web testing.",
			},
		},
		{
			name:    "no frontmatter",
			input:   "# Just a markdown file\n\nNo frontmatter here.",
			wantErr: true,
		},
		{
			name:    "no closing delimiter",
			input:   "---\nname: broken\n",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseFrontmatter([]byte(tt.input))
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Name != tt.want.Name {
				t.Errorf("name = %q, want %q", got.Name, tt.want.Name)
			}
			if got.Description != tt.want.Description {
				t.Errorf("description = %q, want %q", got.Description, tt.want.Description)
			}
		})
	}
}

func TestScanSkills(t *testing.T) {
	// Create a temp directory structure with skill directories
	dir := t.TempDir()

	// Create skill1 with valid SKILL.md
	skill1Dir := filepath.Join(dir, "skill-one")
	os.MkdirAll(skill1Dir, 0o755)
	os.WriteFile(filepath.Join(skill1Dir, "SKILL.md"), []byte(`---
name: skill-one
description: First test skill
---

# Skill One
`), 0o644)

	// Create skill2 with valid SKILL.md
	skill2Dir := filepath.Join(dir, "skill-two")
	os.MkdirAll(skill2Dir, 0o755)
	os.WriteFile(filepath.Join(skill2Dir, "SKILL.md"), []byte(`---
name: skill-two
description: Second test skill
---

# Skill Two
`), 0o644)

	// Create a directory without SKILL.md (should be skipped)
	noSkillDir := filepath.Join(dir, "not-a-skill")
	os.MkdirAll(noSkillDir, 0o755)
	os.WriteFile(filepath.Join(noSkillDir, "README.md"), []byte("not a skill"), 0o644)

	// Create a skill with no description (should be skipped)
	emptyDir := filepath.Join(dir, "empty-desc")
	os.MkdirAll(emptyDir, 0o755)
	os.WriteFile(filepath.Join(emptyDir, "SKILL.md"), []byte(`---
name: empty-desc
description:
---
`), 0o644)

	skills, err := ScanSkills([]string{dir})
	if err != nil {
		t.Fatalf("ScanSkills error: %v", err)
	}

	if len(skills) != 2 {
		t.Fatalf("expected 2 skills, got %d", len(skills))
	}

	// Verify paths are set
	for _, s := range skills {
		if s.Path == "" {
			t.Errorf("skill %q has empty path", s.Name)
		}
	}
}

func TestScanSkillsNonexistentDir(t *testing.T) {
	skills, err := ScanSkills([]string{"/nonexistent/path"})
	if err != nil {
		t.Fatalf("expected no error for nonexistent dir, got: %v", err)
	}
	if len(skills) != 0 {
		t.Fatalf("expected 0 skills, got %d", len(skills))
	}
}

func TestScanSkillsFallbackName(t *testing.T) {
	dir := t.TempDir()

	// Create skill without name in frontmatter - should fall back to dir name
	skillDir := filepath.Join(dir, "my-skill")
	os.MkdirAll(skillDir, 0o755)
	os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(`---
description: A skill with no name field
---

# My Skill
`), 0o644)

	skills, err := ScanSkills([]string{dir})
	if err != nil {
		t.Fatalf("ScanSkills error: %v", err)
	}

	if len(skills) != 1 {
		t.Fatalf("expected 1 skill, got %d", len(skills))
	}

	if skills[0].Name != "my-skill" {
		t.Errorf("expected fallback name 'my-skill', got %q", skills[0].Name)
	}
}
