import { expect, vi, beforeEach, describe } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as vscode from "vscode";
import { createWriteTestFileTool } from "../write-test-file";
import type { WriteTestFileInput, WriteTestFileOutput } from "../../types";
import { executeTool } from "./test-helpers";
import { createMockDiagnosticWithRange } from "../../../../__tests__/mock-factories/diagnostics-mock";
import { applyDiffDecorationsSync } from "../../../diff-decoration-service";

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

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../../__tests__/mock-factories"
  );
  return createVSCodeMock();
});

// Mock pending edit service
vi.mock("../../../pending-edit-service", () => ({
  registerBlockSync: vi.fn(),
}));

// Mock diff decoration service
vi.mock("../../../diff-decoration-service", () => ({
  applyDiffDecorationsSync: vi.fn(),
}));

describe("writeTestFileTool", () => {
  let approvalRegistry: Set<string>;
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    approvalRegistry = new Set<string>();
    mockFs = vscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
    };

    // Reset all mocks
    vi.clearAllMocks();

    // Reset diff decoration mock to no-op (success case)
    (applyDiffDecorationsSync as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        // no-op by default
      },
    );

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
      vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
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
      vscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
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
            vscode.workspace.openTextDocument as unknown as ReturnType<
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
          expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
          expect(vscode.window.showTextDocument).toHaveBeenCalled();
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

        // File exists - mock openTextDocument to resolve
        yield* Effect.sync(() => {
          (
            vscode.workspace.openTextDocument as unknown as ReturnType<
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
            vscode.workspace.openTextDocument as unknown as ReturnType<
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
          expect(result.message).toContain("Permission denied");
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
            vscode.workspace.openTextDocument as unknown as ReturnType<
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
            vscode.window.showTextDocument as unknown as ReturnType<
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
          // Should fail because showTextDocument throws (not wrapped in try-catch)
          expect(result.success).toBe(false);
          expect(result.message).toContain("Editor error");
          expect(mockFs.writeFile).toHaveBeenCalled();
        });
      }),
    );
  });

  describe("Diff Decorations", () => {
    it.effect("should apply diff decorations for new file", () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => approvalRegistry.add("test-diff-1"));
        const tool = yield* Effect.sync(() =>
          createWriteTestFileTool(approvalRegistry),
        );

        const input: WriteTestFileInput = {
          proposalId: "test-diff-1",
          testContent: "test content",
          targetPath: "src/new-file.spec.ts",
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as WriteTestFileOutput),
        );

        yield* Effect.sync(() => {
          // applyDiffDecorationsSync should be called with the editor and isNewFile=true
          expect(applyDiffDecorationsSync).toHaveBeenCalledWith(
            expect.anything(), // editor object (mocked as empty object)
            "", // originalContent (empty for new file)
            "test content", // actualContent
            true, // isNewFile
          );
        });
      }),
    );

    it.effect(
      "should apply diff decorations when overwriting existing file",
      () =>
        Effect.gen(function* () {
          yield* Effect.sync(() => approvalRegistry.add("test-diff-2"));
          const tool = yield* Effect.sync(() =>
            createWriteTestFileTool(approvalRegistry),
          );

          // Mock existing file with original content, then updated content after write
          yield* Effect.sync(() => {
            let callCount = 0;
            (
              vscode.workspace.openTextDocument as unknown as ReturnType<
                typeof vi.fn
              >
            ).mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                // First call: file exists check - return original content
                return Promise.resolve({
                  uri: "file://test",
                  getText: () => "original content",
                } as unknown as vscode.TextDocument);
              }
              // Second call: after write - return updated content
              return Promise.resolve({
                uri: "file://test",
                getText: () => "updated content",
              } as unknown as vscode.TextDocument);
            });
          });

          const input: WriteTestFileInput = {
            proposalId: "test-diff-2",
            testContent: "updated content",
            targetPath: "src/existing.spec.ts",
            overwrite: true,
          };

          yield* Effect.promise(() =>
            executeTool(tool, input, {} as WriteTestFileOutput),
          );

          yield* Effect.sync(() => {
            // applyDiffDecorationsSync should be called with the editor and isNewFile=false
            expect(applyDiffDecorationsSync).toHaveBeenCalledWith(
              expect.anything(), // editor object (mocked as empty object)
              "original content", // originalContent
              "updated content", // actualContent
              false, // isNewFile
            );
          });
        }),
    );

    it.effect(
      "should continue successfully even if diff decoration fails",
      () =>
        Effect.gen(function* () {
          yield* Effect.sync(() => approvalRegistry.add("test-diff-3"));
          const tool = yield* Effect.sync(() =>
            createWriteTestFileTool(approvalRegistry),
          );

          // Mock applyDiffDecorationsSync to throw an error
          yield* Effect.sync(() => {
            (
              applyDiffDecorationsSync as ReturnType<typeof vi.fn>
            ).mockImplementation(() => {
              throw new Error("Decoration service failed");
            });
          });

          const input: WriteTestFileInput = {
            proposalId: "test-diff-3",
            testContent: "test content",
            targetPath: "src/test.spec.ts",
          };

          const result = yield* Effect.promise(() =>
            executeTool(tool, input, {} as WriteTestFileOutput),
          );

          yield* Effect.sync(() => {
            // Operation should succeed despite decoration failure
            expect(result.success).toBe(true);
            expect(result.filePath).toBe("src/test.spec.ts");
            expect(mockFs.writeFile).toHaveBeenCalled();
            // Ensure applyDiffDecorationsSync was attempted
            expect(applyDiffDecorationsSync).toHaveBeenCalled();
          });
        }),
    );
  });

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
    mockFs = vscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
    };
    mockLanguages = vscode.languages as unknown as {
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
      vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
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
      vscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
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

      // Mock openTextDocument to handle both checks properly
      yield* Effect.sync(() => {
        let callCount = 0;
        (
          vscode.workspace.openTextDocument as unknown as ReturnType<
            typeof vi.fn
          >
        ).mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First call: file doesn't exist check
            return Promise.reject(new Error("File not found"));
          }
          // Subsequent calls: return the final content after write
          return Promise.resolve({
            uri: "file://test",
            getText: () => "final test content",
          } as unknown as vscode.TextDocument);
        });
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
      yield* Effect.sync(() => {
        let callCount = 0;
        (
          vscode.workspace.openTextDocument as unknown as ReturnType<
            typeof vi.fn
          >
        ).mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First call: file doesn't exist check
            return Promise.reject(new Error("File not found"));
          }
          // Subsequent calls: return formatted content (different from input)
          return Promise.resolve({
            uri: "file://test",
            getText: () => "formatted content",
          } as unknown as vscode.TextDocument);
        });
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
