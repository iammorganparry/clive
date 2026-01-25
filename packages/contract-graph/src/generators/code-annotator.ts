/**
 * Code Annotator - Inject contract annotations into source code
 *
 * This module provides utilities to inject @contract annotations directly into
 * source files, so AI agents see contract information immediately when reading
 * functions/classes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ContractGraph } from "../graph/graph.js";
import type { Contract } from "../graph/contract.js";

/**
 * Options for annotating source files
 */
export interface AnnotateOptions {
  /** Path to the contracts file (default: 'contracts/system.md') */
  contractsFile?: string;
  /** If true, don't write files - just return what would be changed */
  dryRun?: boolean;
  /** Base directory for resolving file paths (default: process.cwd()) */
  baseDir?: string;
}

/**
 * Result of an annotation operation
 */
export interface AnnotationResult {
  /** File path that was annotated */
  file: string;
  /** Contract ID that was added */
  contractId: string;
  /** Line number where annotation was added */
  line: number;
  /** What action was taken */
  action: "added" | "updated" | "skipped";
  /** Reason for the action (especially for skipped) */
  reason?: string;
}

/**
 * Inject contract annotations into source files
 *
 * For each contract with a valid @location, this function:
 * 1. Reads the source file
 * 2. Finds the target line
 * 3. Checks for existing JSDoc
 * 4. Injects or updates @contract annotation
 *
 * @param graph - The contract graph containing contracts to annotate
 * @param options - Annotation options
 * @returns Array of annotation results
 */
export async function annotateSourceFiles(
  graph: ContractGraph,
  options: AnnotateOptions = {}
): Promise<AnnotationResult[]> {
  const { contractsFile = "contracts/system.md", dryRun = false, baseDir = process.cwd() } = options;

  const results: AnnotationResult[] = [];
  const contracts = graph.getAllContracts();

  // Helper type for contracts with guaranteed location
  interface LocatedContract {
    contract: Contract;
    file: string;
    line: number;
  }

  // Group contracts by file for efficient processing
  const contractsByFile = new Map<string, LocatedContract[]>();
  for (const contract of contracts) {
    const file = contract.location?.file;
    const line = contract.location?.line;
    if (file && line) {
      const existing = contractsByFile.get(file) || [];
      existing.push({ contract, file, line });
      contractsByFile.set(file, existing);
    }
  }

  // Process each file
  for (const [filePath, locatedContracts] of contractsByFile) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      for (const { contract, line } of locatedContracts) {
        results.push({
          file: filePath,
          contractId: contract.id,
          line,
          action: "skipped",
          reason: "File not found",
        });
      }
      continue;
    }

    // Read file content
    let content = fs.readFileSync(absolutePath, "utf-8");

    // Sort contracts by line number descending to avoid offset issues
    const sortedContracts = [...locatedContracts].sort((a, b) => b.line - a.line);

    // Process each contract in this file
    for (const { contract, line } of sortedContracts) {
      const result = injectAnnotationIntoContent(
        content,
        line,
        contract.id,
        contractsFile,
        filePath
      );

      results.push({
        file: filePath,
        contractId: contract.id,
        line,
        action: result.action,
        reason: result.reason,
      });

      if (result.action !== "skipped") {
        content = result.content;
      }
    }

    // Write the modified content if not dry run
    if (!dryRun) {
      const hasModifications = sortedContracts.some(({ contract }) => {
        const r = results.find((r) => r.contractId === contract.id && r.file === filePath);
        return r && r.action !== "skipped";
      });

      if (hasModifications) {
        fs.writeFileSync(absolutePath, content, "utf-8");
      }
    }
  }

  return results;
}

/**
 * Internal result from content injection
 */
interface InjectionResult {
  content: string;
  action: "added" | "updated" | "skipped";
  reason?: string;
}

/**
 * Inject annotation into file content at specified location
 *
 * @param fileContent - The file content to modify
 * @param lineNumber - The target line number (1-indexed)
 * @param contractId - The contract ID to add
 * @param contractsFile - Path to the contracts file for @see link
 * @param filePath - File path for error messages
 * @returns Modified content and action taken
 */
function injectAnnotationIntoContent(
  fileContent: string,
  lineNumber: number,
  contractId: string,
  contractsFile: string,
  _filePath: string
): InjectionResult {
  // Handle empty file
  if (fileContent.trim() === "") {
    return {
      content: fileContent,
      action: "skipped",
      reason: "File is empty",
    };
  }

  const lines = fileContent.split("\n");

  // Validate line number
  if (lineNumber < 1 || lineNumber > lines.length) {
    return {
      content: fileContent,
      action: "skipped",
      reason: `Line ${lineNumber} out of bounds (file has ${lines.length} lines)`,
    };
  }

  // Get the target line (0-indexed internally)
  const targetLineIndex = lineNumber - 1;

  // Detect indentation from target line
  const targetLine = lines[targetLineIndex];
  const indentMatch = targetLine.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  // Look backwards for existing JSDoc
  const jsDocInfo = findExistingJsDoc(lines, targetLineIndex);

  if (jsDocInfo) {
    // Check if @contract already exists
    const existingContract = jsDocInfo.content.match(/@contract\s+(\S+)/);
    if (existingContract) {
      if (existingContract[1] === contractId) {
        return {
          content: fileContent,
          action: "skipped",
          reason: "Already annotated with same contract",
        };
      }
      // Update existing contract annotation
      const updatedJsDoc = jsDocInfo.content.replace(
        /@contract\s+\S+/,
        `@contract ${contractId}`
      );
      // Also update @see if present
      const finalJsDoc = updatedJsDoc.replace(
        /@see\s+contracts\/\S+/,
        `@see ${contractsFile}#${contractId}`
      );

      // Replace the JSDoc in lines
      lines.splice(
        jsDocInfo.startLine,
        jsDocInfo.endLine - jsDocInfo.startLine + 1,
        ...finalJsDoc.split("\n")
      );

      return {
        content: lines.join("\n"),
        action: "updated",
      };
    }

    // Detect single-line JSDoc: /** ... */ on one line
    const isSingleLine = jsDocInfo.startLine === jsDocInfo.endLine;

    if (isSingleLine) {
      // Expand single-line JSDoc to multi-line with contract tags
      const singleLineMatch = jsDocInfo.content.match(/^(\s*)\/\*\*\s*(.*?)\s*\*\/$/);
      if (singleLineMatch) {
        const jsDocIndent = singleLineMatch[1];
        const description = singleLineMatch[2];

        const expandedLines = [
          `${jsDocIndent}/**`,
          ...(description ? [`${jsDocIndent} * ${description}`, `${jsDocIndent} *`] : []),
          `${jsDocIndent} * @contract ${contractId}`,
          `${jsDocIndent} * @see ${contractsFile}#${contractId}`,
          `${jsDocIndent} */`,
        ];

        lines.splice(jsDocInfo.startLine, 1, ...expandedLines);

        return {
          content: lines.join("\n"),
          action: "added",
        };
      }
    }

    // Multi-line JSDoc: Add @contract before closing */
    const closingIndex = jsDocInfo.content.lastIndexOf("*/");
    if (closingIndex === -1) {
      return {
        content: fileContent,
        action: "skipped",
        reason: "Could not find JSDoc closing tag",
      };
    }

    // Insert contract annotation before closing
    // The content before */ may end with whitespace (e.g., " */"), so trim it
    let beforeClosing = jsDocInfo.content.substring(0, closingIndex);
    // Remove trailing whitespace before */ but keep the newline structure
    beforeClosing = beforeClosing.replace(/\s+$/, "");

    // Detect the comment line prefix from existing lines (e.g., " * " or "   * ")
    // Look for pattern like "start-of-line + whitespace + * + space"
    const lineMatch = jsDocInfo.content.match(/\n(\s*)\*\s/);
    const indent = lineMatch ? lineMatch[1] : "";

    // Determine if we need a blank line before contract tags
    // A blank line is needed if the JSDoc doesn't already end with an empty comment line
    const endsWithBlankLine = /\n\s*\*\s*$/.test(beforeClosing);
    const blankLine = endsWithBlankLine ? "" : `\n${indent}*`;

    const contractAnnotation =
      blankLine +
      `\n${indent}* @contract ${contractId}` +
      `\n${indent}* @see ${contractsFile}#${contractId}` +
      `\n${indent}`;

    const updatedJsDoc = beforeClosing + contractAnnotation + "*/";

    // Replace the JSDoc in lines
    lines.splice(
      jsDocInfo.startLine,
      jsDocInfo.endLine - jsDocInfo.startLine + 1,
      ...updatedJsDoc.split("\n")
    );

    return {
      content: lines.join("\n"),
      action: "added",
    };
  }

  // No existing JSDoc - create minimal JSDoc block
  const jsDocBlock = [
    `${indent}/**`,
    `${indent} * @contract ${contractId}`,
    `${indent} * @see ${contractsFile}#${contractId}`,
    `${indent} */`,
  ];

  // Insert the JSDoc before the target line
  lines.splice(targetLineIndex, 0, ...jsDocBlock);

  return {
    content: lines.join("\n"),
    action: "added",
  };
}

/**
 * Information about an existing JSDoc comment
 */
interface JsDocInfo {
  /** Start line index (0-indexed) */
  startLine: number;
  /** End line index (0-indexed) */
  endLine: number;
  /** Full JSDoc content */
  content: string;
}

/**
 * Find existing JSDoc comment above a target line
 *
 * Scans backwards from the target line to find a JSDoc block.
 * Skips blank lines and decorators.
 */
function findExistingJsDoc(lines: string[], targetLineIndex: number): JsDocInfo | null {
  let currentIndex = targetLineIndex - 1;

  // Skip blank lines and decorators
  while (currentIndex >= 0) {
    const line = lines[currentIndex].trim();
    if (line === "" || line.startsWith("@")) {
      currentIndex--;
      continue;
    }
    break;
  }

  if (currentIndex < 0) {
    return null;
  }

  // Check if the line ends with */ (end of JSDoc)
  const potentialEndLine = lines[currentIndex].trim();
  if (!potentialEndLine.endsWith("*/")) {
    return null;
  }

  // Find the start of the JSDoc (line with /**)
  const endLineIndex = currentIndex;
  let startLineIndex = currentIndex;

  while (startLineIndex >= 0) {
    const line = lines[startLineIndex].trim();
    if (line.startsWith("/**")) {
      // Found the start
      break;
    }
    if (line.startsWith("/*") && !line.startsWith("/**")) {
      // This is a regular comment, not JSDoc
      return null;
    }
    startLineIndex--;
  }

  if (startLineIndex < 0 || !lines[startLineIndex].trim().startsWith("/**")) {
    return null;
  }

  // Extract the JSDoc content
  const jsDocLines = lines.slice(startLineIndex, endLineIndex + 1);
  const content = jsDocLines.join("\n");

  return {
    startLine: startLineIndex,
    endLine: endLineIndex,
    content,
  };
}

/**
 * Inject a single annotation into file content
 *
 * This is a convenience function for injecting a single annotation.
 * For multiple annotations in the same file, use annotateSourceFiles instead.
 *
 * @param fileContent - The file content to modify
 * @param lineNumber - The target line number (1-indexed)
 * @param contractId - The contract ID to add
 * @param contractsFile - Path to the contracts file for @see link
 * @returns Modified file content
 */
export function injectAnnotation(
  fileContent: string,
  lineNumber: number,
  contractId: string,
  contractsFile: string = "contracts/system.md"
): string {
  const result = injectAnnotationIntoContent(
    fileContent,
    lineNumber,
    contractId,
    contractsFile,
    "<inline>"
  );
  return result.content;
}

/**
 * Format annotation results for display
 *
 * @param results - Array of annotation results
 * @returns Formatted string for display
 */
export function formatAnnotationResults(results: AnnotationResult[]): string {
  const lines: string[] = ["Code annotations injected:"];

  const byAction = {
    added: results.filter((r) => r.action === "added"),
    updated: results.filter((r) => r.action === "updated"),
    skipped: results.filter((r) => r.action === "skipped"),
  };

  for (const result of byAction.added) {
    lines.push(`- ${result.file}:${result.line} - ${result.contractId} (added)`);
  }

  for (const result of byAction.updated) {
    lines.push(`- ${result.file}:${result.line} - ${result.contractId} (updated)`);
  }

  for (const result of byAction.skipped) {
    lines.push(`- ${result.file}:${result.line} - ${result.contractId} (skipped - ${result.reason})`);
  }

  lines.push("");
  lines.push(`Summary: ${byAction.added.length} added, ${byAction.updated.length} updated, ${byAction.skipped.length} skipped`);

  return lines.join("\n");
}
