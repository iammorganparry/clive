/**
 * Shared VS Code mock factory for unit tests
 * Provides configurable mocks for VS Code API to avoid duplication across test files
 */

import { vi, type Mock } from "vitest";
import type * as vscode from "vscode";

export interface VSCodeMockOverrides {
  workspaceFolders?: vscode.WorkspaceFolder[];
  fs?: {
    stat?: Mock;
    writeFile?: Mock;
    readFile?: Mock;
    createDirectory?: Mock;
  };
  asRelativePath?: Mock;
  openTextDocument?: Mock;
  applyEdit?: Mock;
  findFiles?: Mock;
  Uri?: {
    file?: Mock;
    joinPath?: Mock;
  };
  window?: {
    showInformationMessage?: Mock;
    showErrorMessage?: Mock;
    showTextDocument?: Mock;
    visibleTextEditors?: vscode.TextEditor[];
  };
  WorkspaceEdit?: typeof vscode.WorkspaceEdit;
  languages?: {
    getDiagnostics?: Mock;
  };
  DiagnosticSeverity?: typeof vscode.DiagnosticSeverity;
  Range?: typeof vscode.Range;
  Position?: typeof vscode.Position;
}

/**
 * Module-level singleton for VS Code mock instance
 * This ensures vi.mock("vscode") and test configuration use the same instance
 */
let mockInstance: typeof vscode | null = null;

/**
 * Setup or get the singleton VS Code mock instance
 * This should be called from vi.mock("vscode") and in beforeEach to ensure
 * all code uses the same mock instance
 */
export function setupVSCodeMock(
  overrides?: VSCodeMockOverrides,
): typeof vscode {
  if (!mockInstance) {
    mockInstance = createVSCodeMock(overrides);
  } else if (overrides) {
    // Merge overrides into existing instance
    const newMock = createVSCodeMock(overrides);
    // Deep merge the mock functions
    Object.assign(mockInstance, newMock);
    if (newMock.workspace) {
      Object.assign(mockInstance.workspace, newMock.workspace);
      if (newMock.workspace.fs) {
        Object.assign(mockInstance.workspace.fs, newMock.workspace.fs);
      }
    }
    if (newMock.Uri) {
      Object.assign(mockInstance.Uri, newMock.Uri);
    }
    if (newMock.window) {
      Object.assign(mockInstance.window, newMock.window);
    }
    if (newMock.languages) {
      Object.assign(mockInstance.languages, newMock.languages);
    }
  }
  return mockInstance;
}

/**
 * Reset the singleton mock instance
 * Call this in beforeEach to clear state between tests
 */
export function resetVSCodeMock(): void {
  mockInstance = null;
}

/**
 * Get the current singleton mock instance without creating one
 * Returns null if not yet initialized
 */
export function getVSCodeMock(): typeof vscode | null {
  return mockInstance;
}

/**
 * Create a VS Code mock with configurable overrides
 * Defaults to a standard test workspace setup
 * Note: For tests, prefer using setupVSCodeMock() to ensure singleton pattern
 */
export function createVSCodeMock(
  overrides: VSCodeMockOverrides = {},
): typeof vscode {
  const defaultWorkspaceFolders: vscode.WorkspaceFolder[] = [
    {
      uri: {
        fsPath: "/test-workspace",
        scheme: "file",
        path: "/test-workspace",
        toString: () => "file:///test-workspace",
      } as vscode.Uri,
      name: "test-workspace",
      index: 0,
    },
  ];

  const defaultAsRelativePath = vi.fn((uri: vscode.Uri | string): string => {
    if (typeof uri === "string") return uri;
    return uri.fsPath?.replace("/test-workspace/", "") || uri.path || "";
  });

  const defaultUriFile = vi.fn((path: string): vscode.Uri => {
    return {
      fsPath: path,
      scheme: "file",
      path: path,
      toString: () => `file://${path}`,
    } as vscode.Uri;
  });

  const defaultUriJoinPath = vi.fn(
    (base: vscode.Uri | string, ...paths: string[]): vscode.Uri => {
      const basePath =
        typeof base === "string"
          ? base
          : (base as { fsPath?: string; path?: string }).fsPath ||
            (base as { fsPath?: string; path?: string }).path ||
            "";
      const joined = paths.join("/").replace(/^\.\./, "");
      const fullPath = `${basePath}/${joined}`.replace(/\/+/g, "/");
      return {
        fsPath: fullPath,
        scheme: "file",
        path: fullPath,
        toString: () => `file://${fullPath}`,
      } as vscode.Uri;
    },
  );

  const mockVscode = {
    workspace: {
      workspaceFolders: overrides.workspaceFolders ?? defaultWorkspaceFolders,
      fs: {
        stat:
          overrides.fs?.stat ??
          vi.fn().mockResolvedValue({
            type: 1,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 0,
          }),
        writeFile:
          overrides.fs?.writeFile ?? vi.fn().mockResolvedValue(undefined),
        readFile:
          overrides.fs?.readFile ?? vi.fn().mockResolvedValue(Buffer.from("")),
        createDirectory:
          overrides.fs?.createDirectory ?? vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      asRelativePath: overrides.asRelativePath ?? defaultAsRelativePath,
      openTextDocument:
        overrides.openTextDocument ??
        vi.fn().mockResolvedValue({
          uri: {
            fsPath: "/test-workspace/test.ts",
            toString: () => "file:///test-workspace/test.ts",
          },
          getText: () => "",
          positionAt: (offset: number) => ({ line: 0, character: offset }),
        } as unknown as vscode.TextDocument),
      applyEdit: overrides.applyEdit ?? vi.fn().mockResolvedValue(true),
      findFiles: overrides.findFiles ?? vi.fn(),
    },
    Uri: {
      file: overrides.Uri?.file ?? defaultUriFile,
      joinPath: overrides.Uri?.joinPath ?? defaultUriJoinPath,
    },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    EventEmitter: class MockEventEmitter<T> {
      private listeners: Array<(e: T) => void> = [];
      event = (listener: (e: T) => void) => {
        this.listeners.push(listener);
        return { dispose: vi.fn() };
      };
      fire = (data: T) => {
        for (const listener of this.listeners) {
          listener(data);
        }
      };
      dispose = vi.fn();
    },
    window: {
      showInformationMessage:
        overrides.window?.showInformationMessage ?? vi.fn(),
      showErrorMessage: overrides.window?.showErrorMessage ?? vi.fn(),
      showTextDocument:
        overrides.window?.showTextDocument ?? vi.fn().mockResolvedValue({}),
      visibleTextEditors: overrides.window?.visibleTextEditors ?? [],
      createTextEditorDecorationType: vi.fn(() => ({
        dispose: vi.fn(),
      })),
    },
    WorkspaceEdit:
      overrides.WorkspaceEdit ??
      class MockWorkspaceEdit {
        insert = vi.fn();
        replace = vi.fn();
      },
    languages: {
      getDiagnostics: overrides.languages?.getDiagnostics ?? vi.fn(() => []),
    },
    DiagnosticSeverity: overrides.DiagnosticSeverity ?? {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    Range:
      overrides.Range ??
      class MockRange {
        constructor(
          public start: vscode.Position,
          public end: vscode.Position,
        ) {}
        isEqual(other: vscode.Range): boolean {
          return (
            this.start.line === other.start.line &&
            this.start.character === other.start.character &&
            this.end.line === other.end.line &&
            this.end.character === other.end.character
          );
        }
      },
    Position:
      overrides.Position ??
      class MockPosition {
        constructor(
          public line: number,
          public character: number,
        ) {}
      },
  } as unknown as typeof vscode;

  // Add default export for ES module compatibility
  return Object.assign(mockVscode, { default: mockVscode });
}
