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
}

/**
 * Create a VS Code mock with configurable overrides
 * Defaults to a standard test workspace setup
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

  const defaultAsRelativePath = vi.fn(
    (uri: vscode.Uri | string): string => {
      if (typeof uri === "string") return uri;
      return uri.fsPath?.replace("/test-workspace/", "") || uri.path || "";
    },
  );

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

  return {
    workspace: {
      workspaceFolders:
        overrides.workspaceFolders ?? defaultWorkspaceFolders,
      fs: {
        stat: overrides.fs?.stat ?? vi.fn(),
        writeFile: overrides.fs?.writeFile ?? vi.fn(),
        readFile: overrides.fs?.readFile ?? vi.fn(),
        createDirectory: overrides.fs?.createDirectory ?? vi.fn(),
      },
      asRelativePath: overrides.asRelativePath ?? defaultAsRelativePath,
      openTextDocument:
        overrides.openTextDocument ?? vi.fn(),
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
    window: {
      showInformationMessage:
        overrides.window?.showInformationMessage ?? vi.fn(),
      showErrorMessage: overrides.window?.showErrorMessage ?? vi.fn(),
      showTextDocument:
        overrides.window?.showTextDocument ?? vi.fn(),
      visibleTextEditors:
        overrides.window?.visibleTextEditors ?? [],
    },
    WorkspaceEdit:
      overrides.WorkspaceEdit ??
      class MockWorkspaceEdit {
        insert = vi.fn();
      },
  } as unknown as typeof vscode;
}

/**
 * Setup vi.mock for vscode module using the factory
 * This is a convenience function for test files that want to use vi.mock
 */
export function setupVSCodeMock(overrides?: VSCodeMockOverrides): void {
  const mock = createVSCodeMock(overrides);
  vi.mock("vscode", () => mock);
}

