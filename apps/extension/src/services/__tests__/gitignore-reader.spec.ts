import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  findGitignoreFiles,
  getGitignorePatternsForCypress,
} from "../gitignore-reader.js";

describe("gitignore-reader", () => {
  const tempDir = path.join(__dirname, "../../.test-temp-gitignore");

  beforeEach(() => {
    // Create temp directory for tests
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("findGitignoreFiles", () => {
    it("should find gitignore files in workspace", async () => {
      // Create a test workspace structure
      const workspaceRoot = vscode.Uri.file(tempDir);
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(gitignorePath, "node_modules\n");

      // Mock workspace folders for asRelativePath to work
      vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
        { uri: workspaceRoot, name: "test", index: 0 },
      ]);

      // Mock vscode.workspace.findFiles
      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
        vscode.Uri.file(gitignorePath),
      ]);

      const result = await findGitignoreFiles(workspaceRoot);
      expect(result).toContain(".gitignore");

      vi.restoreAllMocks();
    });

    it("should return empty array when no gitignore files exist", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([]);

      const result = await findGitignoreFiles(workspaceRoot);
      expect(result).toEqual([]);

      vi.restoreAllMocks();
    });
  });

  describe("getGitignorePatternsForCypress", () => {
    it("should parse gitignore patterns and convert to Cypress patterns", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);
      const gitignorePath = path.join(tempDir, ".gitignore");
      const gitignoreContent = [
        "node_modules",
        ".next",
        "dist/",
        "build",
        "# This is a comment",
        "",
        "*.log",
      ].join("\n");
      fs.writeFileSync(gitignorePath, gitignoreContent);

      // Mock workspace folders for asRelativePath to work
      vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
        { uri: workspaceRoot, name: "test", index: 0 },
      ]);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
        vscode.Uri.file(gitignorePath),
      ]);

      const result = await getGitignorePatternsForCypress(workspaceRoot);

      // Should include patterns but not comments or empty lines
      expect(result).toContain("node_modules");
      expect(result).toContain(".next/**");
      expect(result).toContain("dist/**");
      expect(result).toContain("build/**");
      expect(result).toContain("*.log");
      // Should not contain comments
      expect(result.some((p: string) => p.includes("comment"))).toBe(false);

      vi.restoreAllMocks();
    });

    it("should handle directory patterns ending with /", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(gitignorePath, "apps/nextjs/.next/\n");

      // Mock workspace folders for asRelativePath to work
      vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
        { uri: workspaceRoot, name: "test", index: 0 },
      ]);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
        vscode.Uri.file(gitignorePath),
      ]);

      const result = await getGitignorePatternsForCypress(workspaceRoot);

      expect(result.some((p: string) => p.includes(".next"))).toBe(true);

      vi.restoreAllMocks();
    });

    it("should handle patterns with leading slashes", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(gitignorePath, "/dist\n/.next\n");

      // Mock workspace folders for asRelativePath to work
      vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
        { uri: workspaceRoot, name: "test", index: 0 },
      ]);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
        vscode.Uri.file(gitignorePath),
      ]);

      const result = await getGitignorePatternsForCypress(workspaceRoot);

      // Leading slashes should be removed
      expect(result.some((p: string) => p.startsWith("/"))).toBe(false);
      expect(result.some((p: string) => p.includes("dist"))).toBe(true);
      expect(result.some((p: string) => p.includes(".next"))).toBe(true);

      vi.restoreAllMocks();
    });

    it("should skip negation patterns", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(gitignorePath, "*.log\n!important.log\n");

      // Mock workspace folders for asRelativePath to work
      vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
        { uri: workspaceRoot, name: "test", index: 0 },
      ]);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
        vscode.Uri.file(gitignorePath),
      ]);

      const result = await getGitignorePatternsForCypress(workspaceRoot);

      expect(result).toContain("*.log");
      expect(result.some((p: string) => p.includes("!important"))).toBe(false);

      vi.restoreAllMocks();
    });

    it("should return empty array when no gitignore files exist", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([]);

      const result = await getGitignorePatternsForCypress(workspaceRoot);
      expect(result).toEqual([]);

      vi.restoreAllMocks();
    });

    it.skip("should handle multiple gitignore files", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);
      const rootGitignore = path.join(tempDir, ".gitignore");
      const packageGitignore = path.join(
        tempDir,
        "apps",
        "nextjs",
        ".gitignore",
      );
      fs.mkdirSync(path.dirname(packageGitignore), { recursive: true });

      fs.writeFileSync(rootGitignore, "node_modules\n");
      fs.writeFileSync(packageGitignore, ".next\n");

      // Mock workspace folders for asRelativePath to work
      vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
        { uri: workspaceRoot, name: "test", index: 0 },
      ]);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
        vscode.Uri.file(rootGitignore),
        vscode.Uri.file(packageGitignore),
      ]);

      // Mock fs.readFile to return file content
      // The code uses Uri.joinPath which may create paths differently
      // Match by checking if the URI path contains the expected file name
      const originalFs = vscode.workspace.fs;
      vi.spyOn(vscode.workspace, "fs", "get").mockReturnValue({
        ...originalFs,
        readFile: async (uri: vscode.Uri): Promise<Uint8Array> => {
          const filePath = uri.fsPath;
          // Match root gitignore - check if path ends with .gitignore and is at root level
          const relativeToRoot = path.relative(tempDir, filePath);
          if (relativeToRoot === ".gitignore") {
            return new TextEncoder().encode("node_modules\n");
          }
          // Match package gitignore
          if (relativeToRoot === "apps/nextjs/.gitignore") {
            return new TextEncoder().encode(".next\n");
          }
          // Fallback: try to read from actual file system if it exists
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8");
            return new TextEncoder().encode(content);
          }
          // Fallback to original implementation
          return originalFs.readFile(uri);
        },
      } as vscode.FileSystem);

      const result = await getGitignorePatternsForCypress(workspaceRoot);

      expect(result).toContain("node_modules");
      expect(result.some((p: string) => p.includes(".next"))).toBe(true);

      vi.restoreAllMocks();
    });

    it("should remove duplicate patterns", async () => {
      const workspaceRoot = vscode.Uri.file(tempDir);
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(gitignorePath, "node_modules\nnode_modules\n");

      // Mock workspace folders for asRelativePath to work
      vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
        { uri: workspaceRoot, name: "test", index: 0 },
      ]);

      vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
        vscode.Uri.file(gitignorePath),
      ]);

      const result = await getGitignorePatternsForCypress(workspaceRoot);

      const nodeModulesCount = result.filter(
        (p: string) => p === "node_modules",
      ).length;
      expect(nodeModulesCount).toBe(1);

      vi.restoreAllMocks();
    });
  });
});
