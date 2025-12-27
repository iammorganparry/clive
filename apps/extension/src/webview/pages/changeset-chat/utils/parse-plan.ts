/**
 * Utility to parse and extract test plan content from agent messages
 */

export interface ParsedPlan {
  title: string;
  description: string;
  summary: string; // First paragraph or first few lines for preview
  body: string;
  fullContent: string;
}

/**
 * Extract summary from body content - first paragraph or first 5 lines
 */
function extractSummary(body: string): string {
  if (!body.trim()) return "";

  // Try to find first paragraph (text between blank lines)
  const firstParagraphMatch = body.match(/^([^\n]+(?:\n[^\n]+)*)/);
  if (firstParagraphMatch) {
    const paragraph = firstParagraphMatch[1].trim();
    // If paragraph is reasonable length (less than 500 chars), use it
    if (paragraph.length < 500) {
      return paragraph;
    }
    // Otherwise take first sentence or first 300 chars
    const firstSentence = paragraph.match(/^[^.!?]+[.!?]/);
    if (firstSentence && firstSentence[0].length < 500) {
      return firstSentence[0].trim();
    }
    return `${paragraph.substring(0, 300).trim()}...`;
  }

  // Fallback: take first 5 lines
  const lines = body.split("\n").filter((line) => line.trim().length > 0);
  const summaryLines = lines.slice(0, 5);
  return summaryLines.join("\n").trim();
}

/**
 * Detect if text contains a test plan by looking for plan headers
 */
export function hasPlanContent(text: string): boolean {
  const planPatterns = [
    /^##\s+Test Plan:/m, // ## Test Plan: (existing H2 format)
    /^##\s+Recommendation:/m, // ## Recommendation: (existing)
    /^##\s+Test Plan\s*$/m, // ## Test Plan (existing)
    /^name:\s*Test Plan/m, // name: Test Plan... (YAML frontmatter)
    /^#\s+Test Plan/m, // # Test Plan... (H1 header)
  ];

  return planPatterns.some((pattern) => pattern.test(text));
}

/**
 * Parse plan content from markdown text
 * Extracts title, description, and body content
 * Supports multiple formats:
 * 1. YAML frontmatter: name:, overview:, todos:
 * 2. H1 headers: # Test Plan for...
 * 3. H2 headers: ## Test Plan: (backward compatibility)
 */
export function parsePlan(text: string): ParsedPlan | null {
  if (!hasPlanContent(text)) {
    return null;
  }

  // Check for YAML frontmatter format (name:, overview:, todos:)
  const nameMatch = text.match(/^name:\s*(.+)$/m);
  
  if (nameMatch) {
    const title = nameMatch[1]?.trim() || "Test Plan";
    
    // Find overview line (may be on next line or have spacing)
    const overviewMatch = text.match(/^overview:\s*(.+?)(?:\n(?!todos:|#|##)|$)/ms);
    const description = overviewMatch?.[1]?.trim() || "Test proposal for review";

    // Find where frontmatter ends - look for blank line(s) or start of markdown content
    const nameIndex = nameMatch.index ?? 0;
    const afterName = text.slice(nameIndex);
    
    // Find first blank line (double newline) or markdown header after frontmatter
    const blankLineMatch = afterName.match(/\n\n+/);
    const markdownHeaderMatch = afterName.match(/\n#+\s+/);
    
    let bodyStart = text.length;
    if (blankLineMatch && markdownHeaderMatch) {
      // Use whichever comes first
      bodyStart = nameIndex + Math.min(blankLineMatch.index ?? text.length, markdownHeaderMatch.index ?? text.length);
    } else if (blankLineMatch) {
      bodyStart = nameIndex + (blankLineMatch.index ?? 0) + blankLineMatch[0].length;
    } else if (markdownHeaderMatch) {
      bodyStart = nameIndex + (markdownHeaderMatch.index ?? 0);
    }

    // Extract body - everything after frontmatter
    const body = text.slice(bodyStart).trim();
    const fullContent = text.trim();
    const finalBody = body || fullContent; // Use full content if body is empty

    return {
      title,
      description,
      summary: extractSummary(finalBody),
      body: finalBody,
      fullContent,
    };
  }

  // Check for H1 header format (# Test Plan for...)
  const h1HeaderMatch = text.match(/^#\s+Test Plan(?:\s+for\s+(.+?))?(?:\s*:)?$/m);

  if (h1HeaderMatch) {
    const headerIndex = h1HeaderMatch.index ?? 0;
    const headerText = h1HeaderMatch[0];
    const titleMatch = h1HeaderMatch[1]?.trim();

    const title = titleMatch
      ? `Test Plan for ${titleMatch}`
      : "Test Plan";

    // Find the description - usually the first paragraph after the header
    const afterHeader = text.slice(headerIndex + headerText.length);
    const descriptionMatch = afterHeader.match(/^([^\n#]+)/m);
    const description = descriptionMatch
      ? descriptionMatch[1].trim()
      : "Test proposal for review";

    // Extract the full plan body - everything from the header to the end
    const planStart = headerIndex;
    const nextMajorSection = text.slice(planStart).search(/^##\s+[^#]/m);
    const planEnd =
      nextMajorSection > 0 ? planStart + nextMajorSection : text.length;

    const body = text.slice(planStart, planEnd).trim();
    const fullContent = text.trim();

    return {
      title,
      description,
      summary: extractSummary(body),
      body,
      fullContent,
    };
  }

  // Try to find the plan header (existing H2 format for backward compatibility)
  const planHeaderMatch = text.match(
    /^##\s+(Test Plan:|Recommendation:)\s*(.+)?$/m,
  );

  if (!planHeaderMatch) {
    return null;
  }

  const headerIndex = planHeaderMatch.index ?? 0;
  const headerText = planHeaderMatch[0];
  const titleMatch = planHeaderMatch[2]?.trim();

  // Extract title - use the header text or first line after header
  const title = titleMatch || "Test Plan";

  // Find the description - usually the first paragraph after the header
  // or the first line that's not a header
  const afterHeader = text.slice(headerIndex + headerText.length);
  const descriptionMatch = afterHeader.match(/^([^\n#]+)/m);
  const description = descriptionMatch
    ? descriptionMatch[1].trim()
    : "Test proposal for review";

  // Extract the full plan body - everything from the header to the end
  // or until the next major section (if any)
  const planStart = headerIndex;
  const nextMajorSection = text.slice(planStart).search(/^##\s+[^#]/m);
  const planEnd =
    nextMajorSection > 0 ? planStart + nextMajorSection : text.length;

  const body = text.slice(planStart, planEnd).trim();
  const fullContent = text.trim();

  return {
    title,
    description,
    summary: extractSummary(body),
    body,
    fullContent,
  };
}
