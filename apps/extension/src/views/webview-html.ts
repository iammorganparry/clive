import * as vscode from "vscode";

/**
 * Generate HTML content for the webview
 */
export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const webviewUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "webview.js"),
  );
  const webviewCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "webview.css"),
  );

  const nonce = getNonce();

  return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src http://localhost:3000 ${webview.cspSource};">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Clive</title>
			<link href="${webviewCssUri}" rel="stylesheet">
			<style>
				html {
					margin: 0;
					padding: 0;
					width: 100%;
					height: 100%;
				}
				body {
					margin: 0;
					padding: 0;
					width: 100%;
					height: 100%;
					overflow: hidden;
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

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
