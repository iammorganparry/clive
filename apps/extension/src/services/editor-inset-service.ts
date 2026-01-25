/**
 * Editor Inset Service - manages inline webview overlays for diff UI
 * Uses VS Code's proposed editorInsets API to show diff highlighting and accept/reject buttons
 * directly inline with code in the editor.
 */

import type { DiffBlock } from "@clive/core";
import * as vscode from "vscode";

/**
 * Service for managing webview insets in the text editor
 */
export class EditorInsetService {
  private insets: Map<string, vscode.WebviewEditorInset> = new Map();
  private extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Show diff UI for a block using a webview inset
   */
  showDiffUI(
    editor: vscode.TextEditor,
    block: DiffBlock,
    addedLines: string[],
    removedLines: string[],
  ): void {
    const key = `${editor.document.uri.fsPath}:${block.id}`;

    // Dispose existing inset if any
    const existing = this.insets.get(key);
    if (existing) {
      existing.dispose();
    }

    // Calculate height based on number of diff lines + button row
    const diffLineCount = addedLines.length + removedLines.length;
    const height = Math.max(1, diffLineCount + 2); // +2 for buttons and padding, min 1

    // Create webview inset at the start line of the block (convert 1-based to 0-based)
    const inset = vscode.window.createWebviewTextEditorInset(
      editor,
      block.range.startLine - 1,
      height,
      {
        enableScripts: true,
        localResourceRoots: [this.extensionUri],
      },
    );

    // Set HTML content with diff highlighting and styled buttons
    inset.webview.html = this.getInsetHtml(
      block.id,
      addedLines,
      removedLines,
      inset.webview,
    );

    // Handle messages from the webview
    inset.webview.onDidReceiveMessage(
      (message: { command: string; blockId?: string }) => {
        if (message.command === "accept") {
          vscode.commands.executeCommand(
            "clive.acceptEditBlock",
            editor.document.uri,
            message.blockId,
          );
        } else if (message.command === "reject") {
          vscode.commands.executeCommand(
            "clive.rejectEditBlock",
            editor.document.uri,
            message.blockId,
          );
        }
      },
    );

    this.insets.set(key, inset);
  }

  /**
   * Hide UI for a specific block
   */
  hideUI(filePath: string, blockId: string): void {
    const key = `${filePath}:${blockId}`;
    const inset = this.insets.get(key);
    if (inset) {
      inset.dispose();
      this.insets.delete(key);
    }
  }

  /**
   * Hide all UI for a file
   */
  hideAllForFile(filePath: string): void {
    const keysToRemove: string[] = [];
    for (const [key, inset] of this.insets.entries()) {
      if (key.startsWith(`${filePath}:`)) {
        inset.dispose();
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.insets.delete(key);
    }
  }

  /**
   * Generate HTML for the inset webview
   */
  private getInsetHtml(
    blockId: string,
    addedLines: string[],
    removedLines: string[],
    _webview: vscode.Webview,
  ): string {
    const diffHtml = [
      ...removedLines.map(
        (line) =>
          `<div class="diff-line removed">- ${this.escapeHtml(line)}</div>`,
      ),
      ...addedLines.map(
        (line) =>
          `<div class="diff-line added">+ ${this.escapeHtml(line)}</div>`,
      ),
    ].join("\n");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 8px;
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .diff-container {
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .diff-line {
      padding: 2px 8px;
      white-space: pre;
      font-family: var(--vscode-editor-font-family);
      line-height: 1.4;
    }
    .diff-line.added {
      background: var(--vscode-diffEditor-insertedTextBackground, rgba(34, 197, 94, 0.2));
      color: var(--vscode-editor-foreground);
    }
    .diff-line.removed {
      background: var(--vscode-diffEditor-removedTextBackground, rgba(239, 68, 68, 0.2));
      color: var(--vscode-editor-foreground);
    }
    .button-container {
      display: flex;
      gap: 8px;
    }
    button {
      padding: 4px 12px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background-color 0.2s;
    }
    .accept {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .accept:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .reject {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .reject:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="diff-container">
    ${diffHtml}
  </div>
  <div class="button-container">
    <button class="accept" onclick="accept()">✓ Accept</button>
    <button class="reject" onclick="reject()">✕ Reject</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function accept() {
      vscode.postMessage({ command: 'accept', blockId: '${blockId}' });
    }
    function reject() {
      vscode.postMessage({ command: 'reject', blockId: '${blockId}' });
    }
  </script>
</body>
</html>`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Dispose of all insets
   */
  dispose(): void {
    for (const inset of this.insets.values()) {
      inset.dispose();
    }
    this.insets.clear();
  }
}
