/**
 * Utility to parse and extract test plan content from agent messages
 */

export interface ParsedPlan {
  title: string;
  description: string;
  body: string;
  fullContent: string;
}

/**
 * Detect if text contains a test plan by looking for plan headers
 */
export function hasPlanContent(text: string): boolean {
  const planPatterns = [
    /^##\s+Test Plan:/m,
    /^##\s+Recommendation:/m,
    /^##\s+Test Plan\s*$/m,
  ];

  return planPatterns.some((pattern) => pattern.test(text));
}

/**
 * Parse plan content from markdown text
 * Extracts title, description, and body content
 */
export function parsePlan(text: string): ParsedPlan | null {
  if (!hasPlanContent(text)) {
    return null;
  }

  // Try to find the plan header
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
    body,
    fullContent,
  };
}
