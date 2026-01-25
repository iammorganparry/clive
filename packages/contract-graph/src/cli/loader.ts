/**
 * Contract file loader - Discovers and loads contract definitions from disk
 */

import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { glob } from "glob";
import { ContractGraph } from "../graph/graph.js";
import {
  type BuildError,
  buildFromMarkdown,
  buildFromMermaid,
} from "../parser/contract-builder.js";

/**
 * Patterns for finding contract files
 */
const CONTRACT_PATTERNS = [
  "**/contracts/**/*.md",
  "**/contracts.md",
  "**/*.contracts.md",
  "**/CONTRACTS.md",
];

/**
 * Patterns to ignore
 */
const IGNORE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

/**
 * Result of loading contracts
 */
export interface LoadResult {
  graph: ContractGraph;
  errors: BuildError[];
  files: string[];
}

/**
 * Options for loading contracts
 */
export interface LoadOptions {
  /** Patterns to search for (defaults to CONTRACT_PATTERNS) */
  patterns?: string[];
  /** Patterns to ignore */
  ignore?: string[];
  /** Default repository for contracts without @repo */
  defaultRepo?: string;
}

/**
 * Load contracts from a directory
 */
export async function loadContracts(
  dir: string,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const patterns = options.patterns || CONTRACT_PATTERNS;
  const ignore = options.ignore || IGNORE_PATTERNS;

  // Find all contract files
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: dir,
      ignore,
      absolute: true,
    });
    files.push(...matches);
  }

  // Deduplicate
  const uniqueFiles = [...new Set(files)];

  const combinedGraph = new ContractGraph();
  const allErrors: BuildError[] = [];

  // Load each file
  for (const file of uniqueFiles) {
    try {
      const content = await readFile(file, "utf-8");
      const relativePath = relative(dir, file);

      let result;
      if (file.endsWith(".md")) {
        result = buildFromMarkdown(content, {
          sourceFile: relativePath,
          defaultRepo: options.defaultRepo,
        });
      } else {
        // Assume mermaid content directly
        result = buildFromMermaid(content, {
          sourceFile: relativePath,
          defaultRepo: options.defaultRepo,
        });
      }

      combinedGraph.merge(result.graph);
      allErrors.push(
        ...result.errors.map((e) => ({
          ...e,
          message: `[${relativePath}] ${e.message}`,
        })),
      );
    } catch (err) {
      allErrors.push({
        message: `Failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
      });
    }
  }

  return {
    graph: combinedGraph,
    errors: allErrors,
    files: uniqueFiles,
  };
}

/**
 * Watch for contract file changes (for development)
 */
export async function watchContracts(
  dir: string,
  onChange: (result: LoadResult) => void,
  options: LoadOptions = {},
): Promise<() => void> {
  const { watch } = await import("node:fs");

  // Initial load
  const initialResult = await loadContracts(dir, options);
  onChange(initialResult);

  // Set up watchers for contract directories
  const watchers: ReturnType<typeof watch>[] = [];
  const contractDirs = new Set<string>();

  for (const file of initialResult.files) {
    const dirPath = join(file, "..");
    contractDirs.add(dirPath);
  }

  for (const watchDir of contractDirs) {
    const watcher = watch(watchDir, { persistent: true }, async () => {
      const result = await loadContracts(dir, options);
      onChange(result);
    });
    watchers.push(watcher);
  }

  // Return cleanup function
  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

/**
 * Load contracts from a specific file
 */
export async function loadContractsFromFile(
  filePath: string,
  options: Omit<LoadOptions, "patterns"> = {},
): Promise<LoadResult> {
  const content = await readFile(filePath, "utf-8");

  let result;
  if (filePath.endsWith(".md")) {
    result = buildFromMarkdown(content, {
      sourceFile: filePath,
      defaultRepo: options.defaultRepo,
    });
  } else {
    result = buildFromMermaid(content, {
      sourceFile: filePath,
      defaultRepo: options.defaultRepo,
    });
  }

  return {
    graph: result.graph,
    errors: result.errors,
    files: [filePath],
  };
}
