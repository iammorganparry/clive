import { Effect, Layer, Runtime } from "effect";
import * as vscode from "vscode";
import { PlanFileService } from "./plan-file-service.js";
import { VSCodeService } from "./vs-code.js";

/**
 * CodeLens provider for plan markdown files
 * Shows Approve/Reject buttons at the top of plan files
 */
export class PlanCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;

  /**
   * Refresh CodeLens when document changes
   */
  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  /**
   * Provide CodeLens for a document
   */
  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    // Only provide CodeLens for .clive/plans/*.md files
    if (!document.uri.fsPath.includes(".clive/plans")) {
      return [];
    }

    // Only show CodeLens if status is "pending"
    const frontmatterMatch = document.getText().match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return [];
    }

    const frontmatter = frontmatterMatch[1];
    let status: string | undefined;
    let proposalId: string | undefined;
    let subscriptionId: string | undefined;
    let toolCallId: string | undefined;

    for (const line of frontmatter.split("\n")) {
      const statusMatch = line.match(/^status:\s*"(.*)"/);
      const proposalIdMatch = line.match(/^proposalId:\s*"(.*)"/);
      const subscriptionIdMatch = line.match(/^subscriptionId:\s*"(.*)"/);
      const toolCallIdMatch = line.match(/^toolCallId:\s*"(.*)"/);

      if (statusMatch) {
        status = statusMatch[1];
      }
      if (proposalIdMatch) {
        proposalId = proposalIdMatch[1];
      }
      if (subscriptionIdMatch) {
        subscriptionId = subscriptionIdMatch[1];
      }
      if (toolCallIdMatch) {
        toolCallId = toolCallIdMatch[1];
      }
    }

    // Only show CodeLens if status is pending and we have required IDs
    if (status !== "pending" || !proposalId || !subscriptionId || !toolCallId) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    // Approve button - positioned after frontmatter
    const approveRange = new vscode.Range(
      frontmatterMatch[0].split("\n").length,
      0,
      frontmatterMatch[0].split("\n").length,
      0,
    );
    const approveCommand: vscode.Command = {
      title: "$(check) Approve Plan",
      command: "clive.approvePlan",
      arguments: [document.uri, proposalId, subscriptionId, toolCallId],
    };
    codeLenses.push(new vscode.CodeLens(approveRange, approveCommand));

    // Reject button - positioned next to approve
    const rejectRange = new vscode.Range(
      frontmatterMatch[0].split("\n").length + 1,
      0,
      frontmatterMatch[0].split("\n").length + 1,
      0,
    );
    const rejectCommand: vscode.Command = {
      title: "$(x) Reject Plan",
      command: "clive.rejectPlan",
      arguments: [document.uri, proposalId, subscriptionId, toolCallId],
    };
    codeLenses.push(new vscode.CodeLens(rejectRange, rejectCommand));

    return codeLenses;
  }

  /**
   * Resolve CodeLens (optional - can add additional info here)
   */
  resolveCodeLens?(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens | Thenable<vscode.CodeLens> {
    return codeLens;
  }
}

/**
 * Handle approval from CodeLens
 */
export async function handleApprovePlan(
  planUri: vscode.Uri,
  _proposalId: string,
  subscriptionId: string,
  toolCallId: string,
): Promise<void> {
  const runtime = Runtime.defaultRuntime;
  const serviceLayer = Layer.merge(
    PlanFileService.Default,
    VSCodeService.Default,
  );

  // Update plan file status
  await Runtime.runPromise(runtime)(
    Effect.gen(function* () {
      const planFileService = yield* PlanFileService;
      yield* planFileService.updatePlanStatus(planUri, "approved");
    }).pipe(Effect.provide(serviceLayer)),
  ).catch((error) => {
    console.error("Failed to update plan status:", error);
  });

  // Send approval message to webview via command
  // The webview will forward it to the RPC handler
  await vscode.commands.executeCommand("clive.sendApproval", {
    subscriptionId,
    toolCallId,
    data: "Yes, confirmed.",
  });
}

/**
 * Handle rejection from CodeLens
 */
export async function handleRejectPlan(
  planUri: vscode.Uri,
  _proposalId: string,
  subscriptionId: string,
  toolCallId: string,
): Promise<void> {
  const runtime = Runtime.defaultRuntime;
  const serviceLayer = Layer.merge(
    PlanFileService.Default,
    VSCodeService.Default,
  );

  // Update plan file status
  await Runtime.runPromise(runtime)(
    Effect.gen(function* () {
      const planFileService = yield* PlanFileService;
      yield* planFileService.updatePlanStatus(planUri, "rejected");
    }).pipe(Effect.provide(serviceLayer)),
  ).catch((error) => {
    console.error("Failed to update plan status:", error);
  });

  // Send rejection message to webview via command
  await vscode.commands.executeCommand("clive.sendApproval", {
    subscriptionId,
    toolCallId,
    data: "No, denied.",
  });
}
