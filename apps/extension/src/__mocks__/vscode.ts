/**
 * Mock implementation of VS Code API for unit tests
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface MockUri {
  fsPath: string;
  scheme: string;
  toString: () => string;
}

export const Uri = {
  file: (fsPath: string): MockUri => {
    return {
      fsPath,
      scheme: "file",
      toString: () => `file://${fsPath}`,
    };
  },
  joinPath: (base: MockUri | string, ...pathSegments: string[]): MockUri => {
    const basePath =
      typeof base === "string"
        ? base
        : base.fsPath || base.toString().replace("file://", "");
    return Uri.file(path.join(basePath, ...pathSegments));
  },
};

export const workspace = {
  findFiles: async (
    _include: string,
    _exclude?: string,
  ): Promise<MockUri[]> => {
    // Default implementation - tests will mock this
    return [];
  },
  fs: {
    readFile: async (uri: MockUri | string): Promise<Uint8Array> => {
      // Use real file system for tests
      const filePath =
        typeof uri === "string"
          ? uri
          : uri.fsPath || uri.toString().replace("file://", "");
      const content = fs.readFileSync(filePath);
      return new Uint8Array(content);
    },
    writeFile: async (
      uri: MockUri | string,
      content: Uint8Array,
    ): Promise<void> => {
      // Use real file system for tests
      const filePath =
        typeof uri === "string"
          ? uri
          : uri.fsPath || uri.toString().replace("file://", "");
      fs.writeFileSync(filePath, Buffer.from(content));
    },
    stat: async (
      uri: MockUri | string,
    ): Promise<{
      type: number;
      ctime: number;
      mtime: number;
      size: number;
    }> => {
      // Use real file system for tests
      const filePath =
        typeof uri === "string"
          ? uri
          : uri.fsPath || uri.toString().replace("file://", "");
      const stats = fs.statSync(filePath);
      return {
        type: stats.isFile() ? 1 : stats.isDirectory() ? 2 : 0,
        ctime: stats.ctime.getTime(),
        mtime: stats.mtime.getTime(),
        size: stats.size,
      };
    },
  },
  _workspaceFolders: undefined as Array<{ uri: MockUri }> | undefined,
  asRelativePath: (
    uriOrPath: MockUri | string,
    _includeWorkspaceFolder?: boolean,
  ): string => {
    if (typeof uriOrPath === "string") {
      return uriOrPath;
    }
    const fsPath =
      uriOrPath.fsPath || uriOrPath.toString().replace("file://", "");
    // If workspaceFolders is set, compute relative path from first workspace folder
    // Otherwise, return just the filename or relative path
    if (workspace._workspaceFolders && workspace._workspaceFolders.length > 0) {
      const workspacePath = workspace._workspaceFolders[0].uri.fsPath;
      if (fsPath.startsWith(workspacePath)) {
        const relative = path.relative(workspacePath, fsPath);
        return relative || path.basename(fsPath);
      }
    }
    // Fallback: return basename or full path
    return path.basename(fsPath);
  },
  get workspaceFolders(): Array<{ uri: MockUri }> | undefined {
    return this._workspaceFolders;
  },
  set workspaceFolders(value: Array<{ uri: MockUri }> | undefined) {
    this._workspaceFolders = value;
  },
};

export const window = {
  showInformationMessage: (_message: string): Thenable<string | undefined> => {
    return Promise.resolve(undefined);
  },
  showErrorMessage: (_message: string): Thenable<string | undefined> => {
    return Promise.resolve(undefined);
  },
  createTerminal: (
    _options?: unknown,
  ): {
    show: () => void;
    sendText: () => void;
  } => {
    return {
      show: () => {},
      sendText: () => {},
    };
  },
};

const vscode = {
  Uri,
  workspace,
  window,
};

export default vscode;
