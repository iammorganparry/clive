import * as vscode from 'vscode';
import { Console, Effect, Runtime, pipe } from "effect";
import { checkCypressStatus } from "../services/cypress-detector";
import { setupCypress } from "../services/cypress-setup";
import { Views, WebviewMessages } from "../constants";

export class CliveViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = Views.mainView;

	private _webviewView?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this._webviewView = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Send initial theme info
		this.sendThemeInfo();

		// Listen for theme changes
		const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
			this.sendThemeInfo();
		});

		// Clean up on dispose
		webviewView.onDidDispose(() => {
			themeChangeDisposable.dispose();
		});

		// Set up message handling using Effect
		webviewView.webview.onDidReceiveMessage(
			message => {
				pipe(
					Effect.sync(() => {
						switch (message.command) {
							case WebviewMessages.ready:
								Console.log('Clive webview is ready');
								// Check Cypress status when webview is ready
								this.checkAndSendCypressStatus();
								break;
							case WebviewMessages.setupCypress:
								this.handleSetupCypress(message.targetDirectory);
								break;
							case WebviewMessages.refreshStatus:
								this.checkAndSendCypressStatus();
								break;
							default:
								Console.log(`Unknown command: ${message.command}`);
						}
					}),
					Runtime.runPromise(Runtime.defaultRuntime)
				);
			},
			null,
			[]
		);

		// Handle visibility changes
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				pipe(
					Effect.sync(() => {
						Console.log('Clive view became visible');
						// Check Cypress status when view becomes visible
						this.checkAndSendCypressStatus();
					}),
					Runtime.runPromise(Runtime.defaultRuntime)
				);
			}
		});

		// Watch for file changes to re-check status
		const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
		watcher.onDidChange(() => {
			if (webviewView.visible) {
				this.checkAndSendCypressStatus();
			}
		});
		watcher.onDidCreate(() => {
			if (webviewView.visible) {
				this.checkAndSendCypressStatus();
			}
		});
		watcher.onDidDelete(() => {
			if (webviewView.visible) {
				this.checkAndSendCypressStatus();
			}
		});

		// Watch for cypress config file changes
		const configWatcher = vscode.workspace.createFileSystemWatcher('**/cypress.config.{ts,js,mjs}');
		configWatcher.onDidChange(() => {
			if (webviewView.visible) {
				this.checkAndSendCypressStatus();
			}
		});
		configWatcher.onDidCreate(() => {
			if (webviewView.visible) {
				this.checkAndSendCypressStatus();
			}
		});
	}

	/**
	 * Check Cypress status and send to webview
	 */
	private async checkAndSendCypressStatus(): Promise<void> {
		if (!this._webviewView) {
			return;
		}

		const status = await checkCypressStatus();
		if (status) {
			this._webviewView.webview.postMessage({
				command: WebviewMessages.cypressStatus,
				status,
			});
		} else {
			this._webviewView.webview.postMessage({
				command: WebviewMessages.cypressStatus,
				status: {
					overallStatus: 'not_installed' as const,
					packages: [],
					workspaceRoot: '',
				},
				error: 'No workspace folder found',
			});
		}
	}

	/**
	 * Send theme information to webview
	 */
	private sendThemeInfo(): void {
		if (!this._webviewView) {
			return;
		}

		const colorTheme = vscode.window.activeColorTheme;
		const colorScheme = colorTheme.kind === vscode.ColorThemeKind.Dark ||
			colorTheme.kind === vscode.ColorThemeKind.HighContrast
			? 'dark'
			: 'light';

		this._webviewView.webview.postMessage({
			command: WebviewMessages.themeInfo,
			colorScheme,
		});
	}

	/**
	 * Handle Cypress setup request from webview
	 */
	private async handleSetupCypress(targetDirectory?: string): Promise<void> {
		if (!this._webviewView) {
			return;
		}

		// Determine target directory
		let targetDir: string;
		if (targetDirectory) {
			targetDir = targetDirectory;
		} else {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				this._webviewView.webview.postMessage({
					command: WebviewMessages.setupError,
					error: 'No workspace folder found',
				});
				return;
			}
			targetDir = workspaceFolders[0].uri.fsPath;
		}

		// Send loading state
		this._webviewView.webview.postMessage({
			command: WebviewMessages.setupStart,
			targetDirectory: targetDir,
		});

		try {
			await setupCypress({ targetDirectory: targetDir });

			// Wait a bit for the command to start, then re-check status
			setTimeout(() => {
				this.checkAndSendCypressStatus();
			}, 2000);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			this._webviewView.webview.postMessage({
				command: WebviewMessages.setupError,
				error: errorMessage,
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get URIs for built webview assets
		const webviewUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'webview.js')
		);
		const webviewCssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'webview.css')
		);

		// Generate nonce for CSP
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Clive</title>
				<link href="${webviewCssUri}" rel="stylesheet">
			</head>
			<body>
				<div id="root"></div>
				<script nonce="${nonce}" src="${webviewUri}"></script>
			</body>
			</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

