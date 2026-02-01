/**
 * WorktreeService Tests
 *
 * Tests the worktree metadata reader and creator:
 * - Reading valid worktree.json metadata
 * - Handling missing metadata files
 * - Handling invalid/corrupt JSON
 * - Handling deleted worktree directories
 * - Validating required fields
 * - Creating worktrees with new or existing branches
 * - Reconstructing metadata when directory exists
 * - Writing metadata and state files
 * - Error handling during creation
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/test"),
}));

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));
vi.mock("node:child_process", () => {
  const mod = { execSync: mockExecSync };
  return { ...mod, default: mod };
});

import { WorktreeService } from "../WorktreeService";

describe("WorktreeService", () => {
  const mainWorkspaceRoot = "/Users/test/repos/clive";
  const epicId = "abc-123-def-456";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getWorktreeForEpic", () => {
    it("should return metadata when worktree.json exists and directory is valid", () => {
      const metadata = {
        worktreePath: "/Users/test/repos/clive-worktrees/CLIVE-42",
        branchName: "clive/CLIVE-42",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
        createdAt: "2025-01-15T10:30:00Z",
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(metadata));
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
      );

      expect(result).toEqual(metadata);
      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.join(
          mainWorkspaceRoot,
          ".claude",
          "epics",
          epicId,
          "worktree.json",
        ),
        "utf-8",
      );
    });

    it("should return null when worktree.json does not exist", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
      );

      expect(result).toBeNull();
    });

    it("should return null when worktree.json contains invalid JSON", () => {
      vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{");

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
      );

      expect(result).toBeNull();
    });

    it("should return null when worktree directory has been deleted", () => {
      const metadata = {
        worktreePath: "/Users/test/repos/clive-worktrees/CLIVE-42",
        branchName: "clive/CLIVE-42",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
        createdAt: "2025-01-15T10:30:00Z",
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(metadata));
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
      );

      expect(result).toBeNull();
      expect(fs.existsSync).toHaveBeenCalledWith(metadata.worktreePath);
    });

    it("should return null when required field worktreePath is missing", () => {
      const metadata = {
        branchName: "clive/CLIVE-42",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
        createdAt: "2025-01-15T10:30:00Z",
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(metadata));
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
      );

      expect(result).toBeNull();
    });

    it("should return null when required field branchName is missing", () => {
      const metadata = {
        worktreePath: "/Users/test/repos/clive-worktrees/CLIVE-42",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
        createdAt: "2025-01-15T10:30:00Z",
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(metadata));
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
      );

      expect(result).toBeNull();
    });

    it("should return null when required field epicId is missing", () => {
      const metadata = {
        worktreePath: "/Users/test/repos/clive-worktrees/CLIVE-42",
        branchName: "clive/CLIVE-42",
        epicIdentifier: "CLIVE-42",
        createdAt: "2025-01-15T10:30:00Z",
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(metadata));
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
      );

      expect(result).toBeNull();
    });

    it("should construct correct metadata path from workspace root and epic ID", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      WorktreeService.getWorktreeForEpic(
        "/custom/workspace",
        "my-epic-uuid",
      );

      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/custom/workspace/.claude/epics/my-epic-uuid/worktree.json",
        "utf-8",
      );
    });

    it("should return metadata with all fields populated", () => {
      const metadata = {
        worktreePath: "/path/to/worktree",
        branchName: "clive/TEST-99",
        epicId: "uuid-here",
        epicIdentifier: "TEST-99",
        createdAt: "2025-06-01T00:00:00Z",
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(metadata));
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = WorktreeService.getWorktreeForEpic(
        mainWorkspaceRoot,
        "uuid-here",
      );

      expect(result).not.toBeNull();
      expect(result!.worktreePath).toBe("/path/to/worktree");
      expect(result!.branchName).toBe("clive/TEST-99");
      expect(result!.epicId).toBe("uuid-here");
      expect(result!.epicIdentifier).toBe("TEST-99");
      expect(result!.createdAt).toBe("2025-06-01T00:00:00Z");
    });
  });

  describe("createWorktreeForEpic", () => {
    const epicIdentifier = "CLIVE-42";
    const expectedWorktreeDir = path.resolve(
      mainWorkspaceRoot,
      "..",
      "clive-worktrees",
      epicIdentifier,
    );
    const expectedBranch = `clive/${epicIdentifier}`;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should create worktree with new branch when branch does not exist", () => {
      // Directory does not exist
      vi.mocked(fs.existsSync).mockReturnValue(false);
      // Branch does not exist (git rev-parse throws)
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("rev-parse")) {
          throw new Error("fatal: not a valid object name");
        }
        return Buffer.from("");
      });

      const result = WorktreeService.createWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
        epicIdentifier,
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.branchName).toBe(expectedBranch);
      expect(result.metadata!.worktreePath).toBe(expectedWorktreeDir);
      expect(result.metadata!.epicId).toBe(epicId);
      expect(result.metadata!.epicIdentifier).toBe(epicIdentifier);

      // Should have called git worktree add with -b flag
      expect(mockExecSync).toHaveBeenCalledWith(
        `git worktree add -b ${expectedBranch} ${expectedWorktreeDir} HEAD`,
        expect.objectContaining({ cwd: mainWorkspaceRoot }),
      );
    });

    it("should create worktree reusing existing branch", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      // Branch exists (git rev-parse succeeds)
      mockExecSync.mockReturnValue(Buffer.from("abc123"));

      const result = WorktreeService.createWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
        epicIdentifier,
      );

      expect(result.success).toBe(true);

      // Should have called git worktree add WITHOUT -b flag
      expect(mockExecSync).toHaveBeenCalledWith(
        `git worktree add ${expectedWorktreeDir} ${expectedBranch}`,
        expect.objectContaining({ cwd: mainWorkspaceRoot }),
      );
    });

    it("should reconstruct metadata when directory exists but metadata is missing", () => {
      // Directory exists
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = WorktreeService.createWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
        epicIdentifier,
      );

      expect(result.success).toBe(true);
      expect(result.metadata!.worktreePath).toBe(expectedWorktreeDir);

      // Should NOT have called git worktree add
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it("should write metadata to .claude/epics/{epicId}/worktree.json", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      WorktreeService.createWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
        epicIdentifier,
      );

      const expectedMetadataDir = path.join(
        mainWorkspaceRoot,
        ".claude",
        "epics",
        epicId,
      );

      expect(fs.mkdirSync).toHaveBeenCalledWith(expectedMetadataDir, {
        recursive: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(expectedMetadataDir, "worktree.json"),
        expect.stringContaining(`"epicId": "${epicId}"`),
      );
    });

    it("should write state files inside the worktree", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      WorktreeService.createWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
        epicIdentifier,
      );

      const claudeDir = path.join(expectedWorktreeDir, ".claude");

      expect(fs.mkdirSync).toHaveBeenCalledWith(claudeDir, {
        recursive: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(claudeDir, ".worktree-branch"),
        expectedBranch,
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(expectedWorktreeDir, ".worktree-path"),
        expectedWorktreeDir,
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(expectedWorktreeDir, ".worktree-origin"),
        mainWorkspaceRoot,
      );
    });

    it("should return error when git command fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("rev-parse")) {
          throw new Error("fatal: not a valid object name");
        }
        if (typeof cmd === "string" && cmd.includes("worktree add")) {
          throw new Error("fatal: '/path/to/worktree' is a missing directory");
        }
        return Buffer.from("");
      });

      const result = WorktreeService.createWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
        epicIdentifier,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing directory");
      expect(result.metadata).toBeUndefined();
    });

    it("should include correct createdAt timestamp in metadata", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = WorktreeService.createWorktreeForEpic(
        mainWorkspaceRoot,
        epicId,
        epicIdentifier,
      );

      expect(result.metadata!.createdAt).toBe("2025-06-15T12:00:00.000Z");
    });
  });

  describe("syncConfigToWorktree", () => {
    const worktreeDir = "/Users/test/repos/clive-worktrees/CLIVE-42";

    it("should copy existing config files to worktree", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      WorktreeService.syncConfigToWorktree(mainWorkspaceRoot, worktreeDir);

      // Should copy each config file
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(mainWorkspaceRoot, ".claude/CLAUDE.md"),
        path.join(worktreeDir, ".claude/CLAUDE.md"),
      );
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(mainWorkspaceRoot, ".claude/settings.json"),
        path.join(worktreeDir, ".claude/settings.json"),
      );
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(mainWorkspaceRoot, ".clive/config.json"),
        path.join(worktreeDir, ".clive/config.json"),
      );
    });

    it("should skip files that do not exist in main repo", () => {
      // Only .claude/CLAUDE.md exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mainWorkspaceRoot, ".claude/CLAUDE.md");
      });

      WorktreeService.syncConfigToWorktree(mainWorkspaceRoot, worktreeDir);

      // Only one file should be copied
      expect(fs.copyFileSync).toHaveBeenCalledTimes(1);
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(mainWorkspaceRoot, ".claude/CLAUDE.md"),
        path.join(worktreeDir, ".claude/CLAUDE.md"),
      );
    });

    it("should create destination directories before copying", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // For directories, return empty entries
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      WorktreeService.syncConfigToWorktree(mainWorkspaceRoot, worktreeDir);

      // Should create parent dirs for files
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(worktreeDir, ".claude"),
        { recursive: true },
      );
    });

    it("should recursively copy directories", () => {
      // Files exist, directories exist
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Mock readdirSync to return entries with isDirectory method
      const mockFileEntry = {
        name: "test-skill.md",
        isDirectory: () => false,
      };
      vi.mocked(fs.readdirSync).mockReturnValue([mockFileEntry] as any);

      WorktreeService.syncConfigToWorktree(mainWorkspaceRoot, worktreeDir);

      // Should copy file inside .claude/skills/
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(mainWorkspaceRoot, ".claude/skills/test-skill.md"),
        path.join(worktreeDir, ".claude/skills/test-skill.md"),
      );
    });
  });

  describe("copyPlanFile", () => {
    const worktreeDir = "/Users/test/repos/clive-worktrees/CLIVE-42";

    it("should copy main repo current-plan.md when it exists", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return (
          String(p) ===
          path.join(mainWorkspaceRoot, ".claude", "current-plan.md")
        );
      });

      WorktreeService.copyPlanFile(mainWorkspaceRoot, epicId, worktreeDir);

      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(mainWorkspaceRoot, ".claude", "current-plan.md"),
        path.join(worktreeDir, ".claude", "current-plan.md"),
      );
    });

    it("should fall back to ~/.claude/plans/epics/{epicId}/ when main repo plan is missing", () => {
      const homePlanDir = path.join(
        "/Users/test",
        ".claude",
        "plans",
        "epics",
        epicId,
      );

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // Main repo plan doesn't exist, but home plan dir does
        return String(p) === homePlanDir;
      });

      vi.mocked(fs.readdirSync).mockReturnValue([
        "plan-a.md",
        "plan-b.md",
      ] as any);

      vi.mocked(fs.statSync).mockImplementation((p) => {
        if (String(p).endsWith("plan-a.md")) {
          return { mtimeMs: 1000 } as fs.Stats;
        }
        return { mtimeMs: 2000 } as fs.Stats; // plan-b is newer
      });

      WorktreeService.copyPlanFile(mainWorkspaceRoot, epicId, worktreeDir);

      // Should pick the most recent file (plan-b.md)
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(homePlanDir, "plan-b.md"),
        path.join(worktreeDir, ".claude", "current-plan.md"),
      );
    });

    it("should not copy when no plan file is found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      WorktreeService.copyPlanFile(mainWorkspaceRoot, epicId, worktreeDir);

      expect(fs.copyFileSync).not.toHaveBeenCalled();
    });

    it("should create .claude directory in worktree before copying", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return (
          String(p) ===
          path.join(mainWorkspaceRoot, ".claude", "current-plan.md")
        );
      });

      WorktreeService.copyPlanFile(mainWorkspaceRoot, epicId, worktreeDir);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(worktreeDir, ".claude"),
        { recursive: true },
      );
    });
  });
});
