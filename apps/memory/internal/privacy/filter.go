package privacy

import (
	"regexp"
	"strings"
)

// privateTagRegex matches <private>...</private> blocks (non-greedy, dotall).
var privateTagRegex = regexp.MustCompile(`(?s)<private>.*?</private>`)

// StripPrivateTags removes all <private>...</private> blocks from content.
// Returns the cleaned content with stripped blocks replaced by empty string.
func StripPrivateTags(content string) string {
	return strings.TrimSpace(privateTagRegex.ReplaceAllString(content, ""))
}

// HasOnlyPrivateContent returns true if the content is entirely composed of
// <private> blocks and whitespace — meaning nothing useful remains after stripping.
func HasOnlyPrivateContent(content string) bool {
	stripped := StripPrivateTags(content)
	return stripped == ""
}
