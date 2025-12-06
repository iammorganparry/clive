import * as path from "node:path";
import * as vscode from "vscode";
import type { ChangedFile } from "./git-service.js";

export interface EligibleFile extends ChangedFile {
  isEligible: boolean;
  reason?: string;
}

/**
 * Service for filtering React component files eligible for E2E testing
 */
export class ReactFileFilter {
  private readonly reactExtensions = [".tsx", ".jsx"];
  private readonly excludedDirs = [
    "node_modules",
    "dist",
    "build",
    ".next",
    "out",
  ];
  private readonly testPatterns = [
    /\.test\./,
    /\.spec\./,
    /\.test$/,
    /\.spec$/,
  ];

  /**
   * Check if a file is eligible for E2E testing
   */
  async isEligibleForE2E(file: ChangedFile): Promise<boolean> {
    // Check extension
    const ext = path.extname(file.path);
    if (!this.reactExtensions.includes(ext)) {
      return false;
    }

    // Check if file is in excluded directories
    const pathParts = file.path.split(path.sep);
    for (const excludedDir of this.excludedDirs) {
      if (pathParts.includes(excludedDir)) {
        return false;
      }
    }

    // Check if it's a test file
    for (const pattern of this.testPatterns) {
      if (pattern.test(file.path)) {
        return false;
      }
    }

    // Check if file contains React component patterns
    try {
      const content = await vscode.workspace.fs.readFile(
        vscode.Uri.file(file.path),
      );
      const text = Buffer.from(content).toString("utf-8");

      // Check for React component patterns:
      // - default export of function/const
      // - named export of component (PascalCase)
      // - JSX syntax
      const hasDefaultExport =
        /default\s+export\s+(?:function|const|class)\s+\w+/i.test(text) ||
        /export\s+default\s+(?:function|const|class)\s+\w+/i.test(text);
      const hasJSX = /<[A-Z]\w+/.test(text) || /return\s*\(?\s*</.test(text);
      const hasReactImport = /from\s+['"]react['"]/.test(text);

      return (hasDefaultExport || hasJSX) && hasReactImport;
    } catch (error) {
      console.error(`Error reading file ${file.path}:`, error);
      return false;
    }
  }

  /**
   * Filter files to only include those eligible for E2E testing
   */
  async filterEligibleFiles(files: ChangedFile[]): Promise<EligibleFile[]> {
    const eligibleFiles: EligibleFile[] = [];

    for (const file of files) {
      const isEligible = await this.isEligibleForE2E(file);
      eligibleFiles.push({
        ...file,
        isEligible,
      });
    }

    // Return only eligible files
    return eligibleFiles.filter((file) => file.isEligible);
  }
}
