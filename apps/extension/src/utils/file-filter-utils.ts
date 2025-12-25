import * as vscode from "vscode";
import { INDEXING_EXCLUDE_PATTERNS } from "../services/codebase-indexing-service.js";

/**
 * Check if file should be excluded based on exclude patterns
 */
export const shouldExcludeFile = (uri: vscode.Uri): boolean => {
  const relativePath = vscode.workspace.asRelativePath(uri, false);

  for (const pattern of INDEXING_EXCLUDE_PATTERNS) {
    // Convert glob pattern to regex for matching
    const regexPattern = pattern
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\./g, "\\.");

    if (new RegExp(`^${regexPattern}$`).test(relativePath)) {
      return true;
    }
  }

  return false;
};

/**
 * Check if file matches include patterns (source file extensions)
 */
export const matchesIncludePattern = (uri: vscode.Uri): boolean => {
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  const extension = relativePath.split(".").pop()?.toLowerCase();

  // Check common extensions from include patterns
  const includedExtensions = ["ts", "tsx", "js", "jsx"];
  return extension !== undefined && includedExtensions.includes(extension);
};

/**
 * Check if file path should be excluded (string-based version for use in filtering)
 */
export const shouldExcludeFilePath = (filePath: string): boolean => {
  const lowerPath = filePath.toLowerCase();
  // Test files
  if (
    lowerPath.includes(".test.") ||
    lowerPath.includes(".spec.") ||
    lowerPath.includes(".cy.") ||
    lowerPath.includes("/__tests__/") ||
    lowerPath.includes("/__mocks__/") ||
    lowerPath.includes("/test/") ||
    lowerPath.includes("/tests/")
  ) {
    return true;
  }
  // Config files
  if (
    lowerPath.includes(".config.") ||
    lowerPath.endsWith("tsconfig.json") ||
    lowerPath.endsWith("package.json") ||
    lowerPath.endsWith("biome.json") ||
    lowerPath.includes("/scripts/") ||
    lowerPath.includes("/tooling/")
  ) {
    return true;
  }
  // Type definitions
  if (lowerPath.endsWith(".d.ts")) {
    return true;
  }
  return false;
};

/**
 * Check if file path matches allowed extensions
 */
export const matchesAllowedExtension = (filePath: string): boolean => {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx";
};
