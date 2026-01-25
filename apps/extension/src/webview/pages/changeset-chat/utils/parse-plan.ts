/**
 * Utility to parse and extract test plan content from agent messages
 */

export interface ParsedPlan {
  title: string;
  description: string;
  summary: string; // First paragraph or first few lines for preview
  body: string;
  fullContent: string;
  suites?: ParsedPlanSection[]; // Parsed from YAML frontmatter if available
}

export interface ParsedPlanSection {
  sectionNumber: number;
  name: string; // Section heading (e.g., "Unit Tests for Authentication Logic")
  testType: "unit" | "integration" | "e2e";
  targetFilePath: string; // From **File**: link or YAML suites array
  sourceFiles?: string[]; // From YAML suites array
  issue?: string;
  solution?: string;
  description?: string;
  id?: string; // From YAML suites array
}

/**
 * Simple YAML frontmatter parser
 * Extracts YAML content between --- delimiters at the start of text
 */
function parseYAMLFrontmatter(text: string): Record<string, unknown> | null {
  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const yamlContent = frontmatterMatch[1];
  const result: Record<string, unknown> = {};

  // Simple YAML parser for our specific structure
  // Handles: key: value, key: [array], and nested arrays with - items
  const lines = yamlContent.split("\n");
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;
  let currentObject: Record<string, unknown> | null = null;
  let objectsArray: Record<string, unknown>[] | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Top-level key: value
    const keyValueMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):(.*)$/);
    if (keyValueMatch && !line.startsWith(" ")) {
      const key = keyValueMatch[1];
      const value = keyValueMatch[2].trim();

      // Finalize previous array if any
      if (currentKey && currentArray) {
        result[currentKey] = currentArray;
      }
      if (currentKey && objectsArray) {
        result[currentKey] = objectsArray;
      }

      currentKey = key;
      currentArray = null;
      currentObject = null;
      objectsArray = null;

      if (value) {
        // Inline array [a, b, c]
        if (value.startsWith("[") && value.endsWith("]")) {
          const items = value
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""));
          result[key] = items;
          currentKey = null;
        } else {
          // Simple string value
          result[key] = value.replace(/^["']|["']$/g, "");
          currentKey = null;
        }
      }
      // Otherwise it's a multiline value or array (handled below)
    }
    // Array item at top level (2 space indent with dash)
    else if (line.match(/^ {2}- /) && currentKey) {
      const afterDash = line.slice(4).trim();

      // Check if this is an object (has key:value) or simple array item
      const hasKeyValue = afterDash.includes(":");

      if (hasKeyValue) {
        // This is an object in array with inline first property
        // Finalize previous object if any
        if (currentObject && objectsArray) {
          objectsArray.push(currentObject);
        }
        if (!objectsArray) objectsArray = [];
        currentObject = {};
        currentArray = null;

        // Parse the first property
        const propMatch = afterDash.match(/^([a-zA-Z_][a-zA-Z0-9_]*):(.*)$/);
        if (propMatch) {
          const key = propMatch[1];
          const value = propMatch[2].trim();

          if (value.startsWith("[") && value.endsWith("]")) {
            // Inline array
            const items = value
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim().replace(/^["']|["']$/g, ""));
            currentObject[key] = items;
          } else if (value) {
            currentObject[key] = value.replace(/^["']|["']$/g, "");
          }
        }
      } else {
        // Simple array item
        if (!currentArray) currentArray = [];
        const value = afterDash.replace(/^["']|["']$/g, "");
        currentArray.push(value);
        currentObject = null;
        objectsArray = null;
      }
    }
    // Array item in nested property (6 space indent) - CHECK THIS FIRST
    else if (line.match(/^ {6}- /) && currentObject) {
      // Find last array property in current object
      const keys = Object.keys(currentObject);
      const lastKey = keys[keys.length - 1];
      if (lastKey && Array.isArray(currentObject[lastKey])) {
        const value = line
          .slice(8)
          .trim()
          .replace(/^["']|["']$/g, "");
        (currentObject[lastKey] as unknown[]).push(value);
      }
    }
    // Property in object (4 space indent, but not 6 spaces)
    else if (line.match(/^ {4}[^ ]/) && currentObject) {
      const propMatch = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):(.*)$/);
      if (propMatch) {
        const key = propMatch[1];
        const value = propMatch[2].trim();

        if (value.startsWith("[") && value.endsWith("]")) {
          // Inline array
          const items = value
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""));
          currentObject[key] = items;
        } else if (value) {
          currentObject[key] = value.replace(/^["']|["']$/g, "");
        } else {
          // Array will follow
          currentObject[key] = [];
        }
      }
    }
  }

  // Finalize last array/object
  if (currentKey) {
    if (currentArray) {
      result[currentKey] = currentArray;
    } else if (objectsArray) {
      if (currentObject) objectsArray.push(currentObject);
      result[currentKey] = objectsArray;
    }
  }

  return result;
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
 * Detect if text contains a test plan by looking for YAML frontmatter with name field
 */
export function hasPlanContent(text: string): boolean {
  return /^name:\s*.+/m.test(text);
}

/**
 * Parse plan content from markdown text with YAML frontmatter
 * Extracts title, description, body content, and suites from YAML frontmatter
 */
export function parsePlan(text: string): ParsedPlan | null {
  if (!hasPlanContent(text)) {
    return null;
  }

  // Parse YAML frontmatter
  const yamlData = parseYAMLFrontmatter(text);
  let parsedSuites: ParsedPlanSection[] | undefined;

  if (yamlData?.suites && Array.isArray(yamlData.suites)) {
    // Extract suites from YAML frontmatter
    parsedSuites = yamlData.suites.map(
      (suite: Record<string, unknown>, index: number) => ({
        sectionNumber: index + 1,
        id: (suite.id as string) || `suite-${index + 1}`,
        name: (suite.name as string) || "Unnamed Suite",
        testType: (suite.testType as "unit" | "integration" | "e2e") || "unit",
        targetFilePath: (suite.targetFilePath as string) || "",
        sourceFiles: Array.isArray(suite.sourceFiles)
          ? (suite.sourceFiles as string[])
          : [],
        description: suite.description as string | undefined,
      }),
    );
  }

  // Extract metadata from YAML frontmatter
  const nameMatch = text.match(/^name:\s*(.+)$/m);
  if (!nameMatch) {
    return null;
  }

  const title = nameMatch[1]?.trim() || "Test Plan";

  // Find overview line
  const overviewMatch = text.match(
    /^overview:\s*(.+?)(?:\n(?!suites:|#|##)|$)/ms,
  );
  const description = overviewMatch?.[1]?.trim() || "Test proposal for review";

  // Find where frontmatter ends
  const nameIndex = nameMatch.index ?? 0;
  const afterName = text.slice(nameIndex);

  // Find first blank line (double newline) or markdown header after frontmatter
  const blankLineMatch = afterName.match(/\n\n+/);
  const markdownHeaderMatch = afterName.match(/\n#+\s+/);

  let bodyStart = text.length;
  if (blankLineMatch && markdownHeaderMatch) {
    // Use whichever comes first
    bodyStart =
      nameIndex +
      Math.min(
        blankLineMatch.index ?? text.length,
        markdownHeaderMatch.index ?? text.length,
      );
  } else if (blankLineMatch) {
    bodyStart =
      nameIndex + (blankLineMatch.index ?? 0) + blankLineMatch[0].length;
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
    suites: parsedSuites,
  };
}

/**
 * Parse Implementation Plan sections from plan content
 * Extracts suites from YAML frontmatter
 */
export function parsePlanSections(planContent: string): ParsedPlanSection[] {
  // Parse YAML frontmatter for suites array
  const yamlData = parseYAMLFrontmatter(planContent);

  if (yamlData?.suites && Array.isArray(yamlData.suites)) {
    // Extract suites from YAML frontmatter
    return yamlData.suites.map(
      (suite: Record<string, unknown>, index: number) => ({
        sectionNumber: index + 1,
        id: (suite.id as string) || `suite-${index + 1}`,
        name: (suite.name as string) || "Unnamed Suite",
        testType: (suite.testType as "unit" | "integration" | "e2e") || "unit",
        targetFilePath: (suite.targetFilePath as string) || "",
        sourceFiles: Array.isArray(suite.sourceFiles)
          ? (suite.sourceFiles as string[])
          : [],
        description: suite.description as string | undefined,
      }),
    );
  }

  // No suites found in YAML frontmatter
  return [];
}
