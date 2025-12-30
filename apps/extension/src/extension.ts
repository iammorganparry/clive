// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { CliveViewProvider } from "./views/clive-view-provider.js";
import { CommandCenter } from "./commands/command-center.js";
import { DiffContentProvider } from "./services/diff-content-provider.js";
import { Effect, Runtime, Layer } from "effect";
import { ConfigService } from "./services/config-service.js";
import { createSecretStorageLayer } from "./services/vs-code.js";
import { createLoggerLayer } from "./services/logger-service.js";
import { Commands } from "./constants.js";
import {
  PlanCodeLensProvider,
  handleApprovePlan,
  handleRejectPlan,
} from "./services/plan-codelens-provider.js";
import {
  EditCodeLensService,
  handleAcceptEdit,
  handleRejectEdit,
  handleAcceptEditBlock,
  handleRejectEditBlock,
  setEditCodeLensServiceInstance,
} from "./services/edit-codelens-provider.js";
import {
  PendingEditService,
  setPendingEditServiceInstance,
} from "./services/pending-edit-service.js";
import {
  DiffDecorationService,
  setDiffDecorationServiceInstance,
} from "./services/diff-decoration-service.js";

// Build-time constant injected by esbuild
declare const __DEV__: boolean;

const commandCenter = new CommandCenter();

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel("Clive");

/**
 * Extension exports for testing purposes
 */
export interface ExtensionExports {
  context: vscode.ExtensionContext;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): ExtensionExports {
  outputChannel.appendLine("Clive extension is activating...");
  outputChannel.appendLine(
    'Congratulations, your extension "clive" is now active!',
  );

  // Auto-detect debug mode from extension context
  const isDev =
    __DEV__ || context.extensionMode === vscode.ExtensionMode.Development;
  const loggerLayer = createLoggerLayer(outputChannel, isDev);

  // Migrate auth token from globalState to SecretStorage (one-time migration)
  const oldAuthToken = context.globalState.get<string>("auth_token");
  if (oldAuthToken) {
    const secretStorageLayer = createSecretStorageLayer(context);
    const configServiceLayer = Layer.merge(
      ConfigService.Default,
      secretStorageLayer,
    );

    Effect.gen(function* () {
      const configService = yield* ConfigService;
      yield* configService.storeAuthToken(oldAuthToken);
    })
      .pipe(
        Effect.provide(Layer.merge(configServiceLayer, loggerLayer)),
        Effect.catchAll((err: unknown) =>
          Effect.sync(() => {
            outputChannel.appendLine(
              `Failed to migrate auth token to SecretStorage: ${err}`,
            );
          }),
        ),
        Runtime.runPromise(Runtime.defaultRuntime),
      )
      .catch(() => {
        // Ignore errors during migration
      });
    // Clear old token from globalState after migration
    context.globalState.update("auth_token", undefined);
  }

  // Register the diff content provider
  const diffProvider = DiffContentProvider.register(context);

  // Register plan CodeLens provider
  const planCodeLensProvider = new PlanCodeLensProvider();
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { pattern: "**/.clive/plans/*.md" },
    planCodeLensProvider,
  );
  context.subscriptions.push(codeLensDisposable);

  // Refresh CodeLens when documents change
  const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
    () => {
      planCodeLensProvider.refresh();
    },
  );
  context.subscriptions.push(onDidChangeTextDocument);

  // Register approval/rejection commands
  const approvePlanDisposable = vscode.commands.registerCommand(
    Commands.approvePlan,
    async (
      planUri: vscode.Uri,
      proposalId: string,
      subscriptionId: string,
      toolCallId: string,
    ) => {
      await handleApprovePlan(planUri, proposalId, subscriptionId, toolCallId);
      planCodeLensProvider.refresh();
    },
  );
  context.subscriptions.push(approvePlanDisposable);

  const rejectPlanDisposable = vscode.commands.registerCommand(
    Commands.rejectPlan,
    async (
      planUri: vscode.Uri,
      proposalId: string,
      subscriptionId: string,
      toolCallId: string,
    ) => {
      await handleRejectPlan(planUri, proposalId, subscriptionId, toolCallId);
      planCodeLensProvider.refresh();
    },
  );
  context.subscriptions.push(rejectPlanDisposable);

  // Register refreshCodeLens command (used to refresh CodeLens after plan file updates)
  const refreshCodeLensDisposable = vscode.commands.registerCommand(
    Commands.refreshCodeLens,
    () => {
      planCodeLensProvider.refresh();
    },
  );
  context.subscriptions.push(refreshCodeLensDisposable);

  // Initialize edit services with proper layer composition
  // This ensures all services share the same PendingEditService and DiffDecorationService instances
  const sharedServicesLayer = Layer.merge(
    PendingEditService.Default,
    DiffDecorationService.Default,
  );

  const editServicesLayer = Layer.merge(
    sharedServicesLayer,
    EditCodeLensService.Default,
  );

  // Extract all services from the same composed layer
  const { pendingEditService, diffDecorationService, editCodeLensService } =
    Runtime.runSync(Runtime.defaultRuntime)(
      Effect.gen(function* () {
        return {
          pendingEditService: yield* PendingEditService,
          diffDecorationService: yield* DiffDecorationService,
          editCodeLensService: yield* EditCodeLensService,
        };
      }).pipe(Effect.provide(editServicesLayer)),
    );

  // Set singletons for synchronous access from tools
  setPendingEditServiceInstance(pendingEditService);
  setDiffDecorationServiceInstance(diffDecorationService);
  setEditCodeLensServiceInstance(editCodeLensService);

  // Get the CodeLens provider and register it
  const editCodeLensProvider = Runtime.runSync(Runtime.defaultRuntime)(
    editCodeLensService.getProvider(),
  );
  const editCodeLensDisposable = vscode.languages.registerCodeLensProvider(
    { scheme: "file" },
    editCodeLensProvider,
  );
  context.subscriptions.push(editCodeLensDisposable);

  // Register accept/reject edit commands
  const acceptEditDisposable = vscode.commands.registerCommand(
    Commands.acceptEdit,
    async (fileUri: vscode.Uri) => {
      await handleAcceptEdit(fileUri);
    },
  );
  context.subscriptions.push(acceptEditDisposable);

  const rejectEditDisposable = vscode.commands.registerCommand(
    Commands.rejectEdit,
    async (fileUri: vscode.Uri) => {
      await handleRejectEdit(fileUri);
    },
  );
  context.subscriptions.push(rejectEditDisposable);

  // Register block-level accept/reject commands
  const acceptEditBlockDisposable = vscode.commands.registerCommand(
    Commands.acceptEditBlock,
    async (fileUri: vscode.Uri, blockId: string) => {
      await handleAcceptEditBlock(fileUri, blockId);
    },
  );
  context.subscriptions.push(acceptEditBlockDisposable);

  const rejectEditBlockDisposable = vscode.commands.registerCommand(
    Commands.rejectEditBlock,
    async (fileUri: vscode.Uri, blockId: string) => {
      await handleRejectEditBlock(fileUri, blockId);
    },
  );
  context.subscriptions.push(rejectEditBlockDisposable);

  // Register accept/reject all blocks commands (aliases for acceptEdit/rejectEdit)
  const acceptAllBlocksDisposable = vscode.commands.registerCommand(
    Commands.acceptAllBlocks,
    async (fileUri: vscode.Uri) => {
      await handleAcceptEdit(fileUri);
    },
  );
  context.subscriptions.push(acceptAllBlocksDisposable);

  const rejectAllBlocksDisposable = vscode.commands.registerCommand(
    Commands.rejectAllBlocks,
    async (fileUri: vscode.Uri) => {
      await handleRejectEdit(fileUri);
    },
  );
  context.subscriptions.push(rejectAllBlocksDisposable);

  // Clean up services when extension deactivates
  context.subscriptions.push({
    dispose: () => {
      Runtime.runSync(Runtime.defaultRuntime)(diffDecorationService.dispose());
      Runtime.runSync(Runtime.defaultRuntime)(editCodeLensService.dispose());
      Runtime.runSync(Runtime.defaultRuntime)(pendingEditService.dispose());
    },
  });

  // Register sendApproval command (used by CodeLens to send approval to RPC)
  const sendApprovalDisposable = vscode.commands.registerCommand(
    Commands.sendApproval,
    async (data: {
      subscriptionId: string;
      toolCallId: string;
      data: string;
    }) => {
      // Send approval message via webview (will be handled by RPC handler)
      const webview = provider.getWebview();
      if (webview) {
        webview.webview.postMessage({
          subscriptionId: data.subscriptionId,
          type: "approval",
          toolCallId: data.toolCallId,
          data: data.data,
        });
      }
    },
  );
  context.subscriptions.push(sendApprovalDisposable);

  // Register the webview view provider
  const provider = new CliveViewProvider(context.extensionUri, diffProvider);
  provider.setContext(context);
  provider.setOutputChannel(outputChannel);
  provider.setIsDev(isDev);

  const webviewProviderDisposable = vscode.window.registerWebviewViewProvider(
    CliveViewProvider.viewType,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  context.subscriptions.push(webviewProviderDisposable);

  // Register all commands via CommandCenter
  commandCenter.registerAll(context);

  // Return exports for testing
  return { context };
}

// This method is called when your extension is deactivated
export function deactivate() {}
