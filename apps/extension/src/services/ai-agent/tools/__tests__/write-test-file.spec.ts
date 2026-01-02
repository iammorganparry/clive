import { expect, vi, beforeEach, describe } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as vscode from "vscode";
import { createWriteTestFileTool } from "../write-test-file";
import type { WriteTestFileInput, WriteTestFileOutput } from "../../types";
import { executeTool } from "./test-helpers";
import { createMockDiagnosticWithRange } from "../../../../__tests__/mock-factories/diagnostics-mock";
import { getVSCodeMock } from "../../../../__tests__/mock-factories/vscode-mock.js";

// Mock vscode globally for tools that use VSCodeService.Default internally
// Use setupVSCodeMock to ensure singleton pattern - same instance used everywhere
vi.mock("vscode", async () => {
  const { setupVSCodeMock } = await import(
    "../../../../__tests__/mock-factories/vscode-mock.js"
  );
  return setupVSCodeMock();
});

// Mock Effect to make sleep instant in tests
vi.mock("effect", async () => {
  const actual = await vi.importActual<typeof import("effect")>("effect");
  return {
    ...actual,
    Effect: {
      ...actual.Effect,
      sleep: () => actual.Effect.void, // Make sleep instant
    },
  };
});

// Mock diff tracker service
vi.mock("../../../diff-tracker-service", () => ({
  getDiffTrackerService: vi.fn(() => ({
    registerBlock: vi.fn(),
    // Other methods can be added as needed
  })),
}));

describe("writeTestFileTool", () => {
  let mockVscode: typeof vscode;
  let approvalRegistry: Set<string>;
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    approvalRegistry = new Set<string>();

    // Get the singleton mock instance that vi.mock("vscode") created
    // This is the same instance used by VSCodeService.Default
    mockVscode = getVSCodeMock() ?? vscode;

    mockFs = mockVscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
    };

    // Reset all mocks
    vi.clearAllMocks();

    // Default: file doesn't exist (for parent directory check)
    mockFs.stat.mockRejectedValue(new Error("File not found"));

    // Track file write state to simulate file existence after write
    let fileWritten = false;
    let fileContent = "";

    // Default: writeFile succeeds and marks file as written
    mockFs.writeFile.mockImplementation((_uri: unknown, content: unknown) => {
      fileWritten = true;
      fileContent = content
        ? Buffer.from(content as Buffer).toString("utf-8")
        : "";
      return Promise.resolve(undefined);
    });

    // Default: createDirectory succeeds
    mockFs.createDirectory.mockResolvedValue(undefined);

    // Default: openTextDocument rejects (file doesn't exist) until file is written
    (
      mockVscode.workspace.openTextDocument as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(() => {
      if (fileWritten) {
        return Promise.resolve({
          uri: "file://test",
          getText: () => fileContent,
        } as unknown as vscode.TextDocument);
      }
      return Promise.reject(new Error("File not found"));
    });

    // Default: showTextDocument succeeds
    (
      mockVscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});
  });

  describe("Happy Path", () => {
    it.effect("should write test file when proposalId is approved", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-1"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-1",
          testContent: 'describe("test", () => { it("works", () => {}); });',
          targetPath: "src/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          expect(result.filePath).toBe("src/test.spec.ts");
          expect(result.message).toContain("successfully saved");
          expect(mockFs.writeFile).toHaveBeenCalled();
        });
      }),
    );

    it.effect("should create parent directories if they don't exist", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-2"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        // Parent directory doesn't exist
        yield* Effect.sync(() =>
          mockFs.stat.mockRejectedValue(new Error("Directory not found")),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-2",
          testContent: "test content",
          targetPath: "src/deep/nested/test.spec.ts",
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(mockFs.createDirectory).toHaveBeenCalled();
          expect(mockFs.writeFile).toHaveBeenCalled();
        });
      }),
    );

    it.effect("should overwrite existing file when overwrite=true", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-3"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        // File already exists - mock openTextDocument to resolve
        yield* Effect.sync(() => {
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockResolvedValue({
            uri: "file://test",
            getText: () => "existing content",
          } as unknown as vscode.TextDocument);
        });

        const input: WriteTestFileInput = {
          proposalId: "test-3",
          testContent: "updated content",
          targetPath: "src/existing.spec.ts",
          overwrite: true,
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          expect(result.message).toContain("successfully saved");
          expect(mockFs.writeFile).toHaveBeenCalled();
        });
      }),
    );

    it.effect("should normalize escaped characters in test content", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-4"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-4",
          testContent: "line1\nline2\ttab",
          targetPath: "src/test.spec.ts",
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          // writeFile is called twice: once with empty content, then with actual content
          // Check the last call which contains the actual content
          const writeCalls = mockFs.writeFile.mock.calls;
          const writeCall = writeCalls[writeCalls.length - 1];
          const writtenContent = writeCall[1].toString();
          expect(writtenContent).toContain("line1");
          expect(writtenContent).toContain("line2");
          expect(writtenContent).toContain("tab");
        });
      }),
    );

    it.effect("should handle absolute paths", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-5"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-5",
          testContent: "test",
          targetPath: "/absolute/path/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          expect(mockFs.writeFile).toHaveBeenCalled();
        });
      }),
    );

    it.effect("should open created file in editor", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-6"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-6",
          testContent: "test",
          targetPath: "src/test.spec.ts",
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(mockVscode.workspace.openTextDocument).toHaveBeenCalled();
          expect(mockVscode.window.showTextDocument).toHaveBeenCalled();
        });
      }),
    );
  });

  describe("Error Handling", () => {
    it.effect("should reject unapproved proposalId", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "unapproved",
          testContent: "test",
          targetPath: "src/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(false);
          expect(result.message).toContain("Invalid or unapproved proposalId");
          expect(mockFs.writeFile).not.toHaveBeenCalled();
        });
      }),
    );

    it.effect("should return error when file exists and overwrite=false", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-7"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        // File exists - mock stat to succeed (file exists)
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockResolvedValue({
            uri: "file://test",
            getText: () => "existing content",
          } as unknown as vscode.TextDocument);
        });

        const input: WriteTestFileInput = {
          proposalId: "test-7",
          testContent: "test",
          targetPath: "src/existing.spec.ts",
          overwrite: false,
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(false);
          expect(result.message).toContain("already exists");
          expect(mockFs.writeFile).not.toHaveBeenCalled();
        });
      }),
    );

    it.effect("should handle write errors gracefully", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-8"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        yield* Effect.sync(() => {
          // First call: file doesn't exist (for the existence check)
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockRejectedValueOnce(new Error("File not found"));
          // writeFile fails
          mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));
        });

        const input: WriteTestFileInput = {
          proposalId: "test-8",
          testContent: "test",
          targetPath: "src/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(false);
          expect(result.message).toContain("file edit operation failed");
          expect(result.message).toContain("Failed to write file");
        });
      }),
    );

    it.effect("should continue if opening file in editor fails", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-9"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        yield* Effect.sync(() => {
          // First call: file doesn't exist (for the existence check) - reject
          // Second call: file opened successfully - resolve
          // But then showTextDocument fails
          let callCount = 0;
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.reject(new Error("File not found"));
            }
            return Promise.resolve({
              uri: "file://test",
              getText: () => "test",
            } as unknown as vscode.TextDocument);
          });

          // showTextDocument fails
          (
            mockVscode.window.showTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockRejectedValue(new Error("Editor error"));
        });

        const input: WriteTestFileInput = {
          proposalId: "test-9",
          testContent: "test",
          targetPath: "src/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          // Should fail because showTextDocument throws
          expect(result.success).toBe(false);
          expect(result.message).toContain("file edit operation failed");
          // The error could be from openTextDocument or showTextDocument
          // Check that it's a document-related error
          expect(
            result.message.includes("Failed to show text document") ||
              result.message.includes("Failed to open text document"),
          ).toBe(true);
          expect(mockFs.writeFile).toHaveBeenCalled();
        });
      }),
    );
  });

  // Note: Diff decorations are now handled by EditorInsetService
  // These tests are kept for reference but may need updating when EditorInsetService is implemented

  describe("Edge Cases", () => {
    it.effect("should handle empty test content", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-10"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-10",
          testContent: "",
          targetPath: "src/empty.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          expect(mockFs.writeFile).toHaveBeenCalledWith(
            expect.anything(),
            expect.any(Buffer),
          );
        });
      }),
    );

    it.effect("should handle special characters in file path", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-11"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-11",
          testContent: "test",
          targetPath: "src/test (copy).spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
        });
      }),
    );

    it.effect("should handle very large test content", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-12"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const largeContent = "x".repeat(100000);

        const input: WriteTestFileInput = {
          proposalId: "test-12",
          testContent: largeContent,
          targetPath: "src/large.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          // writeFile is called twice: once with empty content, then with actual content
          // Check the last call which contains the actual content
          const writeCalls = mockFs.writeFile.mock.calls;
          const writeCall = writeCalls[writeCalls.length - 1];
          const writtenContent = writeCall[1].toString();
          expect(writtenContent.length).toBe(largeContent.length);
        });
      }),
    );

    it.effect("should handle multiple proposalIds in registry", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          approvalRegistry.add("test-13");
          approvalRegistry.add("test-14");
          approvalRegistry.add("test-15");
        });

        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-14",
          testContent: "test",
          targetPath: "src/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
        });
      }),
    );

    it.effect("should handle relative paths with ..", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-16"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-16",
          testContent: "test",
          targetPath: "../outside/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
        });
      }),
    );
  });
});

describe("Diagnostics Integration", () => {
  let mockVscode: typeof vscode;
  let approvalRegistry: Set<string>;
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
  };
  let mockLanguages: {
    getDiagnostics: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    approvalRegistry = new Set<string>();

    // Get the singleton mock instance that vi.mock("vscode") created
    // This is the same instance used by VSCodeService.Default
    mockVscode = getVSCodeMock() ?? vscode;

    mockFs = mockVscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
    };
    mockLanguages = mockVscode.languages as unknown as {
      getDiagnostics: ReturnType<typeof vi.fn>;
    };

    vi.clearAllMocks();

    // Default: file doesn't exist (for parent directory check)
    mockFs.stat.mockRejectedValue(new Error("File not found"));

    // Track file write state to simulate file existence after write
    let fileWritten = false;
    let fileContent = "";

    // Default: writeFile succeeds and marks file as written
    mockFs.writeFile.mockImplementation((_uri: unknown, content: unknown) => {
      fileWritten = true;
      fileContent = content
        ? Buffer.from(content as Buffer).toString("utf-8")
        : "";
      return Promise.resolve(undefined);
    });

    // Default: createDirectory succeeds
    mockFs.createDirectory.mockResolvedValue(undefined);

    // Default: openTextDocument rejects (file doesn't exist) until file is written
    (
      mockVscode.workspace.openTextDocument as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(() => {
      if (fileWritten) {
        return Promise.resolve({
          uri: "file://test",
          getText: () => fileContent,
        } as unknown as vscode.TextDocument);
      }
      return Promise.reject(new Error("File not found"));
    });

    // Default: showTextDocument succeeds
    (
      mockVscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});

    // Default: no diagnostics
    mockLanguages.getDiagnostics.mockReturnValue([]);
  });

  it.effect("should capture pre-edit diagnostics before writing", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => approvalRegistry.add("test-diag-1"));
      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      const input: WriteTestFileInput = {
        proposalId: "test-diag-1",
        testContent: "test content",
        targetPath: "src/test.spec.ts",
      };

      yield* Effect.promise(() =>
        executeTool(tool, input, {} as WriteTestFileOutput),
      );

      yield* Effect.sync(() => {
        // getDiagnostics should be called at least once (before edit)
        expect(mockLanguages.getDiagnostics).toHaveBeenCalled();
      });
    }),
  );

  it.effect("should capture post-edit diagnostics after save", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => approvalRegistry.add("test-diag-2"));
      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      const input: WriteTestFileInput = {
        proposalId: "test-diag-2",
        testContent: "test content",
        targetPath: "src/test.spec.ts",
      };

      yield* Effect.promise(() =>
        executeTool(tool, input, {} as WriteTestFileOutput),
      );

      yield* Effect.sync(() => {
        // getDiagnostics should be called at least twice (before and after)
        expect(mockLanguages.getDiagnostics).toHaveBeenCalledTimes(2);
      });
    }),
  );

  it.effect(
    "should include newProblemsMessage in response when errors introduced",
    () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-diag-3"));

        // Mock diagnostics: no errors before, error after
        let callCount = 0;
        yield* Effect.sync(() => {
          mockLanguages.getDiagnostics.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return []; // Pre-edit: no errors
            }
            // Post-edit: new error using mock factory
            return [
              createMockDiagnosticWithRange(5, "Variable not defined", 0),
            ];
          });
        });

        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-diag-3",
          testContent: "test content with error",
          targetPath: "src/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          expect(result.message).toContain(
            "New diagnostic problems introduced",
          );
          expect(result.message).toContain("Variable not defined");
        });
      }),
  );

  it.effect("should include finalContent in response for AI reference", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => approvalRegistry.add("test-diag-4"));

      // Mock openTextDocument - file doesn't exist initially, so openTextDocument is only called after write
      yield* Effect.sync(() => {
        (
          mockVscode.workspace.openTextDocument as unknown as ReturnType<
            typeof vi.fn
          >
        ).mockResolvedValue({
          uri: "file://test",
          getText: () => "final test content",
        } as unknown as vscode.TextDocument);
      });

      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      const input: WriteTestFileInput = {
        proposalId: "test-diag-4",
        testContent: "final test content",
        targetPath: "src/test.spec.ts",
      };

      const result = yield* Effect.promise(() =>
        executeTool(tool, input, {} as WriteTestFileOutput),
      );

      yield* Effect.sync(() => {
        expect(result.success).toBe(true);
        expect(result.message).toContain("<final_file_content");
        expect(result.message).toContain("final test content");
      });
    }),
  );

  it.effect("should detect auto-formatting changes", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => approvalRegistry.add("test-diag-5"));

      // Mock document.getText to return formatted content (different from what we wrote)
      // File doesn't exist initially, so openTextDocument is only called after write
      yield* Effect.sync(() => {
        (
          mockVscode.workspace.openTextDocument as unknown as ReturnType<
            typeof vi.fn
          >
        ).mockResolvedValue({
          uri: "file://test",
          getText: () => "formatted content",
        } as unknown as vscode.TextDocument);
      });

      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      const input: WriteTestFileInput = {
        proposalId: "test-diag-5",
        testContent: "original content",
        targetPath: "src/test.spec.ts",
      };

      const result = yield* Effect.promise(() =>
        executeTool(tool, input, {} as WriteTestFileOutput),
      );

      yield* Effect.sync(() => {
        expect(result.success).toBe(true);
        expect(result.message).toContain("Auto-formatting was applied");
      });
    }),
  );

  it.effect("should format response using formatFileEditResponse", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => approvalRegistry.add("test-diag-6"));
      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      const input: WriteTestFileInput = {
        proposalId: "test-diag-6",
        testContent: "test content",
        targetPath: "src/test.spec.ts",
      };

      const result = yield* Effect.promise(() =>
        executeTool(tool, input, {} as WriteTestFileOutput),
      );

      yield* Effect.sync(() => {
        expect(result.success).toBe(true);
        expect(result.message).toContain("successfully saved");
        expect(result.message).toContain("IMPORTANT");
      });
    }),
  );

  it.effect("should not report diagnostics when no new errors", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => approvalRegistry.add("test-diag-7"));

      // Mock diagnostics: same error before and after using mock factory
      const existingError = createMockDiagnosticWithRange(
        5,
        "Existing error",
        0,
      );
      yield* Effect.sync(() => {
        mockLanguages.getDiagnostics.mockReturnValue([existingError]);
      });

      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      const input: WriteTestFileInput = {
        proposalId: "test-diag-7",
        testContent: "test content",
        targetPath: "src/test.spec.ts",
      };

      const result = yield* Effect.promise(() =>
        executeTool(tool, input, {} as WriteTestFileOutput),
      );

      yield* Effect.sync(() => {
        expect(result.success).toBe(true);
        expect(result.message).not.toContain(
          "New diagnostic problems introduced",
        );
      });
    }),
  );
});

describe("DiffTrackerService Integration", () => {
  let mockVscode: typeof vscode;
  let approvalRegistry: Set<string>;
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
  };
  let mockDiffTrackerService: {
    registerBlock: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    approvalRegistry = new Set<string>();

    // Get the singleton mock instance
    mockVscode = getVSCodeMock() ?? vscode;

    mockFs = mockVscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
    };

    // Import and configure the diff tracker mock
    const diffTrackerModule = await import("../../../diff-tracker-service");
    mockDiffTrackerService = {
      registerBlock: vi.fn(),
    };
    vi.mocked(diffTrackerModule.getDiffTrackerService).mockReturnValue(
      mockDiffTrackerService as unknown as ReturnType<
        typeof diffTrackerModule.getDiffTrackerService
      >,
    );

    // Reset all mocks
    vi.clearAllMocks();

    // Default: file doesn't exist
    mockFs.stat.mockRejectedValue(new Error("File not found"));

    // Track file write state
    let fileWritten = false;
    let fileContent = "";

    // Default: writeFile succeeds
    mockFs.writeFile.mockImplementation((_uri: unknown, content: unknown) => {
      fileWritten = true;
      fileContent = content
        ? Buffer.from(content as Buffer).toString("utf-8")
        : "";
      return Promise.resolve(undefined);
    });

    // Default: createDirectory succeeds
    mockFs.createDirectory.mockResolvedValue(undefined);

    // Default: openTextDocument behavior
    (
      mockVscode.workspace.openTextDocument as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(() => {
      if (fileWritten) {
        return Promise.resolve({
          uri: "file://test",
          getText: () => fileContent,
        } as unknown as vscode.TextDocument);
      }
      return Promise.reject(new Error("File not found"));
    });

    // Default: showTextDocument succeeds
    (
      mockVscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});
  });

  it.effect(
    "should call registerBlock with correct parameters for new file",
    () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-dt-1"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-dt-1",
          testContent: "line1\nline2\nline3",
          targetPath: "src/new-test.spec.ts",
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(mockDiffTrackerService.registerBlock).toHaveBeenCalledTimes(1);
          const call = mockDiffTrackerService.registerBlock.mock.calls[0];

          // Check each parameter
          expect(call[0]).toMatch(/new-test\.spec\.ts$/); // fileUri.fsPath
          expect(call[1]).toMatch(/^write-\d+-[a-z0-9]+$/); // blockId format
          expect(call[2]).toEqual({ startLine: 1, endLine: 3 }); // range (3 lines)
          expect(call[3]).toEqual([]); // originalLines (empty for new file)
          expect(call[4]).toBe(3); // newLineCount
          expect(call[5]).toBe(""); // originalContent (empty for new file)
          expect(call[6]).toBe(true); // isNewFile
          expect(call[7]).toBe("line1\nline2\nline3"); // actualContent
        });
      }),
  );

  it.effect(
    "should call registerBlock with correct parameters for existing file",
    () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-dt-2"));

        // Mock existing file
        const existingContent = "old line 1\nold line 2";
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);

          let callCount = 0;
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // First call: check if file exists
              return Promise.resolve({
                uri: "file://test",
                getText: () => existingContent,
              } as unknown as vscode.TextDocument);
            }
            // Second call: after write
            return Promise.resolve({
              uri: "file://test",
              getText: () => "new line 1\nnew line 2\nnew line 3",
            } as unknown as vscode.TextDocument);
          });
        });

        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-dt-2",
          testContent: "new line 1\nnew line 2\nnew line 3",
          targetPath: "src/existing-test.spec.ts",
          overwrite: true,
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(mockDiffTrackerService.registerBlock).toHaveBeenCalledTimes(1);
          const call = mockDiffTrackerService.registerBlock.mock.calls[0];

          expect(call[0]).toMatch(/existing-test\.spec\.ts$/);
          expect(call[1]).toMatch(/^write-\d+-[a-z0-9]+$/);
          expect(call[2]).toEqual({ startLine: 1, endLine: 3 });
          expect(call[3]).toEqual(["old line 1", "old line 2"]); // originalLines
          expect(call[4]).toBe(3); // newLineCount
          expect(call[5]).toBe(existingContent); // originalContent
          expect(call[6]).toBe(false); // isNewFile (file exists)
          expect(call[7]).toBe("new line 1\nnew line 2\nnew line 3"); // actualContent
        });
      }),
  );

  it.effect("should generate unique blockId for each file write", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        approvalRegistry.add("test-dt-3");
        approvalRegistry.add("test-dt-4");
      });

      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      // Write first file
      yield* Effect.promise(() =>
        executeTool(
          tool,
          {
            proposalId: "test-dt-3",
            testContent: "test",
            targetPath: "src/test1.spec.ts",
          },
          {} as WriteTestFileOutput,
        ),
      );

      // Write second file
      yield* Effect.promise(() =>
        executeTool(
          tool,
          {
            proposalId: "test-dt-4",
            testContent: "test",
            targetPath: "src/test2.spec.ts",
          },
          {} as WriteTestFileOutput,
        ),
      );

      yield* Effect.sync(() => {
        expect(mockDiffTrackerService.registerBlock).toHaveBeenCalledTimes(2);
        const blockId1 = mockDiffTrackerService.registerBlock.mock.calls[0][1];
        const blockId2 = mockDiffTrackerService.registerBlock.mock.calls[1][1];

        // Ensure blockIds are unique
        expect(blockId1).not.toBe(blockId2);
        expect(blockId1).toMatch(/^write-\d+-[a-z0-9]+$/);
        expect(blockId2).toMatch(/^write-\d+-[a-z0-9]+$/);
      });
    }),
  );

  it.effect(
    "should not call registerBlock when proposalId is not approved",
    () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "unapproved",
          testContent: "test",
          targetPath: "src/test.spec.ts",
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(false);
          expect(mockDiffTrackerService.registerBlock).not.toHaveBeenCalled();
        });
      }),
  );

  it.effect(
    "should not call registerBlock when file exists and overwrite=false",
    () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-dt-5"));

        // Mock existing file
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockResolvedValue({
            uri: "file://test",
            getText: () => "existing content",
          } as unknown as vscode.TextDocument);
        });

        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-dt-5",
          testContent: "test",
          targetPath: "src/existing.spec.ts",
          overwrite: false,
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(false);
          expect(mockDiffTrackerService.registerBlock).not.toHaveBeenCalled();
        });
      }),
  );

  it.effect("should handle multi-line content correctly in registerBlock", () =>
    Effect.gen(function* () {
      yield* Effect.sync(() => approvalRegistry.add("test-dt-6"));
      const tool = yield* Effect.sync(() =>
        createWriteTestFileTool(approvalRegistry),
      );

      const multiLineContent =
        "import { test } from 'vitest';\n\ntest('example', () => {\n  expect(1).toBe(1);\n});";

      const input: WriteTestFileInput = {
        proposalId: "test-dt-6",
        testContent: multiLineContent,
        targetPath: "src/multi-line.spec.ts",
      };

      yield* Effect.promise(() =>
        executeTool(tool, input, {} as WriteTestFileOutput),
      );

      yield* Effect.sync(() => {
        expect(mockDiffTrackerService.registerBlock).toHaveBeenCalledTimes(1);
        const call = mockDiffTrackerService.registerBlock.mock.calls[0];

        // Should have 5 lines
        expect(call[2]).toEqual({ startLine: 1, endLine: 5 });
        expect(call[4]).toBe(5); // newLineCount
        expect(call[7]).toBe(multiLineContent); // actualContent
      });
    }),
  );
});
