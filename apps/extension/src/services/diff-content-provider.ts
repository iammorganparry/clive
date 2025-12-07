import { Uri, EventEmitter } from "vscode";
import type { CancellationToken } from "vscode";
import type * as vscode from "vscode";
import { Effect, Runtime } from "effect";
import { VSCodeService } from "./vs-code.js";

/**
 * Virtual document content provider for diff previews
 * Stores proposed test content and serves it via clive-diff:// URIs
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private static readonly SCHEME = "clive-diff";
  private contentMap = new Map<string, string>();

  /**
   * Register the content provider with VS Code
   */
  static register(context: vscode.ExtensionContext): DiffContentProvider {
    const provider = new DiffContentProvider();

    // Use Effect for registration
    Runtime.runPromise(Runtime.defaultRuntime)(
      Effect.gen(function* () {
        const vscode = yield* VSCodeService;
        const disposable = vscode.workspace.registerTextDocumentContentProvider(
          DiffContentProvider.SCHEME,
          provider,
        );
        context.subscriptions.push(disposable);
      }).pipe(Effect.provide(VSCodeService.Default)),
    ).catch((error) => {
      console.error("Failed to register DiffContentProvider:", error);
    });

    return provider;
  }

  /**
   * Store content for a test ID and return the URI
   * @param testId The test ID
   * @param content The content to store
   * @param type The URI type: "proposed", "existing", or "empty"
   */
  storeContent(
    testId: string,
    content: string,
    type: "proposed" | "existing" | "empty" = "proposed",
  ): Uri {
    const uri = Uri.parse(`${DiffContentProvider.SCHEME}://${type}/${testId}`);
    // Map to content key based on type
    const contentKey =
      type === "proposed"
        ? testId
        : type === "existing"
          ? `existing-${testId}`
          : `empty-${testId}`;
    this.contentMap.set(contentKey, content);
    // Notify VS Code that the document has changed
    this.onDidChangeEmitter.fire(uri);
    return uri;
  }

  /**
   * Get the URI for a test ID
   */
  getUri(testId: string): Uri {
    return Uri.parse(`${DiffContentProvider.SCHEME}://proposed/${testId}`);
  }

  /**
   * Provide content for a virtual document URI
   */
  provideTextDocumentContent(uri: Uri, _token: CancellationToken): string {
    // Handle different URI patterns:
    // clive-diff://proposed/{testId} - proposed content
    // clive-diff://existing/{testId} - existing content
    // clive-diff://empty/{testId} - empty content
    const pathParts = uri.path.split("/");
    const type = pathParts[0]; // "proposed", "existing", or "empty"
    const testId = pathParts[1];

    if (!testId) {
      return "";
    }

    // Map URI to content key
    const contentKey =
      type === "proposed"
        ? testId
        : type === "existing"
          ? `existing-${testId}`
          : `empty-${testId}`;

    return this.contentMap.get(contentKey) || "";
  }

  private onDidChangeEmitter = new EventEmitter<Uri>();
  onDidChange = this.onDidChangeEmitter.event;
}
