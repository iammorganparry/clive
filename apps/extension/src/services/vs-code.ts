import { Effect } from "effect";
import vscode from "vscode";

export class VSCodeService extends Effect.Service<VSCodeService>()(
  "VSCodeService",
  {
    effect: Effect.succeed({
      // @ts-expect-error - secrets is not a property of vscode
      secrets: vscode.secrets as vscode.SecretStorage,
      workspace: vscode.workspace,
    }),
    dependencies: [],
  },
) {}
