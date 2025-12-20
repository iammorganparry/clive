import type * as vscode from "vscode";
import type { CypressDetector } from "../services/cypress-detector.js";
import type { DiffContentProvider } from "../services/diff-content-provider.js";
import type { GitService } from "../services/git-service.js";
import type { ReactFileFilter } from "../services/react-file-filter.js";
import type { ConfigService } from "../services/config-service.js";

/**
 * RPC request context - provides access to extension services
 */
export interface RpcContext {
  webviewView: vscode.WebviewView;
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  isDev: boolean;
  cypressDetector: CypressDetector;
  gitService: GitService;
  reactFileFilter: ReactFileFilter;
  diffProvider: DiffContentProvider;
  configService: ConfigService;
}
