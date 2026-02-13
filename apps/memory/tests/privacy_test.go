package tests

import (
	"testing"

	"github.com/iammorganparry/clive/apps/memory/internal/privacy"
)

func TestStripPrivateTags(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "no private tags",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name:     "single private tag",
			input:    "public <private>secret</private> visible",
			expected: "public  visible",
		},
		{
			name:     "multiple private tags",
			input:    "a <private>x</private> b <private>y</private> c",
			expected: "a  b  c",
		},
		{
			name:     "multiline private content",
			input:    "before <private>\nsecret line 1\nsecret line 2\n</private> after",
			expected: "before  after",
		},
		{
			name:     "nested-looking tags (greedy test)",
			input:    "<private>outer <private>inner</private> still</private> visible",
			expected: "still</private> visible",
		},
		{
			name:     "empty private tags",
			input:    "hello <private></private> world",
			expected: "hello  world",
		},
		{
			name:     "private tag at start",
			input:    "<private>secret</private> visible",
			expected: "visible",
		},
		{
			name:     "private tag at end",
			input:    "visible <private>secret</private>",
			expected: "visible",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := privacy.StripPrivateTags(tt.input)
			if got != tt.expected {
				t.Errorf("StripPrivateTags(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestHasOnlyPrivateContent(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{
			name:     "entirely private",
			input:    "<private>all secret</private>",
			expected: true,
		},
		{
			name:     "entirely private with whitespace",
			input:    "  <private>all secret</private>  ",
			expected: true,
		},
		{
			name:     "multiple private blocks only",
			input:    "<private>a</private> <private>b</private>",
			expected: true,
		},
		{
			name:     "has public content",
			input:    "public <private>secret</private>",
			expected: false,
		},
		{
			name:     "empty string",
			input:    "",
			expected: true,
		},
		{
			name:     "whitespace only",
			input:    "   ",
			expected: true,
		},
		{
			name:     "no private tags at all",
			input:    "completely public",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := privacy.HasOnlyPrivateContent(tt.input)
			if got != tt.expected {
				t.Errorf("HasOnlyPrivateContent(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}
