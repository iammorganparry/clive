import * as vscode from "vscode";
import { CypressDetector } from "../services/cypress-detector.js";
import { CypressSetup } from "../services/cypress-setup.js";
import { Views, WebviewMessages } from "../constants.js";

// Custom JWT authentication - token stored in VS Code persistent state


export class CliveViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = Views.mainView;

	private _webviewView?: vscode.WebviewView;
	private _context?: vscode.ExtensionContext;
	private _outputChannel?: vscode.OutputChannel;
	private cypressDetector: CypressDetector;
	private cypressSetup: CypressSetup;

	constructor(private readonly _extensionUri: vscode.Uri) {
		this.cypressDetector = new CypressDetector();
		this.cypressSetup = new CypressSetup();
	}

	public setContext(context: vscode.ExtensionContext): void {
		this._context = context;
	}

	public setOutputChannel(outputChannel: vscode.OutputChannel): void {
		this._outputChannel = outputChannel;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._webviewView = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Send initial theme info
		this.sendThemeInfo();

		// Listen for theme changes
		const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(
			() => {
				this.sendThemeInfo();
			}
		);

		// Clean up on dispose
		webviewView.onDidDispose(() => {
			themeChangeDisposable.dispose();
		});

		// Set up message handling
		webviewView.webview.onDidReceiveMessage(
			(message) => {
				switch (message.command) {
					case WebviewMessages.ready:
						console.log("Clive webview is ready");
						// Check Cypress status when webview is ready
						this.checkAndSendCypressStatus();
						// Send stored auth token if available
						this.sendStoredAuthToken();
						break;
					case WebviewMessages.setupCypress:
						this.handleSetupCypress(message.targetDirectory);
						break;
					case WebviewMessages.refreshStatus:
						this.checkAndSendCypressStatus();
						break;
					case WebviewMessages.openLoginPage:
						this.handleOpenLoginPage(message.url as string | undefined);
						break;
					case WebviewMessages.openSignupPage:
						this.handleOpenSignupPage(message.url as string | undefined);
						break;
					case WebviewMessages.checkSession:
						this.sendStoredAuthToken();
						break;
					case WebviewMessages.logout:
						this.handleLogout();
						break;
					case WebviewMessages.log:
						if (this._outputChannel && message.data) {
							const logData = message.data as { level?: string; message: string; data?: unknown };
							const level = logData.level || "info";
							const logMessage = logData.data 
								? `${logData.message}: ${JSON.stringify(logData.data, null, 2)}`
								: logData.message;
							this._outputChannel.appendLine(`[${level.toUpperCase()}] ${logMessage}`);
						}
						break;
					default:
						console.log(`Unknown command: ${message.command}`);
				}
			},
			null,
			[]
		);

		// Handle visibility changes
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				console.log("Clive view became visible");
				// Check Cypress status when view becomes visible
				this.checkAndSendCypressStatus();
			}
		});

		// Watch for file changes to re-check status
		const watcher = vscode.workspace.createFileSystemWatcher("**/package.json");
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
		const configWatcher = vscode.workspace.createFileSystemWatcher(
			"**/cypress.config.{ts,js,mjs}"
		);
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

		const status = await this.cypressDetector.checkStatus();
		if (status) {
			this._webviewView.webview.postMessage({
				command: WebviewMessages.cypressStatus,
				status,
			});
		} else {
			this._webviewView.webview.postMessage({
				command: WebviewMessages.cypressStatus,
				status: {
					overallStatus: "not_installed" as const,
					packages: [],
					workspaceRoot: "",
				},
				error: "No workspace folder found",
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
		const colorScheme =
			colorTheme.kind === vscode.ColorThemeKind.Dark ||
			colorTheme.kind === vscode.ColorThemeKind.HighContrast
				? "dark"
				: "light";

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
					error: "No workspace folder found",
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
			await this.cypressSetup.setup({ targetDirectory: targetDir });

			// Wait a bit for the command to start, then re-check status
			setTimeout(() => {
				this.checkAndSendCypressStatus();
			}, 2000);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this._webviewView.webview.postMessage({
				command: WebviewMessages.setupError,
				error: errorMessage,
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get URIs for built webview assets
		const webviewUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "webview.js")
		);
		const webviewCssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "webview.css")
		);

		// Generate nonce for CSP
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src http://localhost:3000;">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Clive</title>
				<link href="${webviewCssUri}" rel="stylesheet">
				<style>
					body {
						margin: 0;
						padding: 0;
						width: 100%;
						height: 100%;
					}
					#root {
						width: 100%;
						height: 100%;
					}
				</style>
			</head>
			<body>
				<div id="root">
					<div style="padding: 20px; color: red;">Loading...</div>
				</div>
				<script nonce="${nonce}">
					console.log("Webview HTML loaded");
					console.log("Script source:", "${webviewUri.toString()}");
					console.log("CSS source:", "${webviewCssUri.toString()}");
					
					// Add error handler for script loading
					window.addEventListener("error", (event) => {
						console.error("Script error:", event.error);
						console.error("Error details:", {
							message: event.message,
							filename: event.filename,
							lineno: event.lineno,
							colno: event.colno
						});
					});
					
					// Check if script loaded after a delay
					setTimeout(() => {
						if (document.getElementById("root")?.innerHTML.includes("Loading...")) {
							console.error("React did not mount! Script may have failed to load.");
							console.error("Check Network tab for webview.js loading errors.");
						}
					}, 2000);
				</script>
				<script nonce="${nonce}" src="${webviewUri}" onerror="console.error('Failed to load webview.js script!')"></script>
			</body>
			</html>`;
	}

	/**
	 * Handle OAuth callback from URI handler
	 * This is called when the VS Code deep link is opened after OAuth completes
	 */
	public async handleOAuthCallback(uri: vscode.Uri): Promise<void> {
		if (!this._webviewView || !this._context) {
			return;
		}

		const params = new URLSearchParams(uri.query);
		const token = params.get("token");
		const error = params.get("error");
		const errorMessage = params.get("message");

		if (error) {
			// Authentication failed
			this._webviewView.webview.postMessage({
				command: WebviewMessages.oauthCallback,
				error: errorMessage || error,
			});
			return;
		}

		if (token) {
			// Authentication successful - save token to persistent state
			await this._context.globalState.update("auth_token", token);
			
			// Send token to webview
			this._webviewView.webview.postMessage({
				command: WebviewMessages.authToken,
				token,
			});
		} else {
			// Unknown state
			this._webviewView.webview.postMessage({
				command: WebviewMessages.oauthCallback,
				error: "No token received",
			});
		}
	}

	/**
	 * Send stored auth token to webview
	 */
	private sendStoredAuthToken(): void {
		if (!this._webviewView || !this._context) {
			return;
		}

		const token = this._context.globalState.get<string>("auth_token");
		if (token) {
			this._webviewView.webview.postMessage({
				command: WebviewMessages.authToken,
				token,
			});
		}
	}

	/**
	 * Handle logout request from webview
	 */
	private handleLogout(): void {
		if (!this._context) {
			return;
		}

		// Remove token from persistent state
		this._context.globalState.update("auth_token", undefined);
	}

	/**
	 * Handle open login page request from webview
	 */
	private async handleOpenLoginPage(url?: string): Promise<void> {
		const loginUrl = url || "http://localhost:3000/login";
		await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
	}

	/**
	 * Handle open signup page request from webview
	 */
	private async handleOpenSignupPage(url?: string): Promise<void> {
		const signupUrl = url || "http://localhost:3000/signup";
		await vscode.env.openExternal(vscode.Uri.parse(signupUrl));
	}
}

function getNonce(): string {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
