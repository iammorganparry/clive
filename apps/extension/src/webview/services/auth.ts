import type { VSCodeAPI } from "./vscode.js";
import { WebviewMessages } from "../../constants.js";

const NEXTJS_BASE_URL = "http://localhost:3000";
const VSCODE_CALLBACK_URL = "vscode://clive.auth/callback";

/**
 * Open the login page in the user's browser
 * The extension will handle opening the browser via vscode.env.openExternal()
 */
export function openLoginPage(vscode: VSCodeAPI): void {
	const callbackUrl = encodeURIComponent(VSCODE_CALLBACK_URL);
	const loginUrl = `${NEXTJS_BASE_URL}/login?callback_url=${callbackUrl}`;
	
	vscode.postMessage({
		command: WebviewMessages.openLoginPage,
		url: loginUrl,
	});
}

/**
 * Open the signup page in the user's browser
 * The extension will handle opening the browser via vscode.env.openExternal()
 */
export function openSignupPage(vscode: VSCodeAPI): void {
	const callbackUrl = encodeURIComponent(VSCODE_CALLBACK_URL);
	const signupUrl = `${NEXTJS_BASE_URL}/signup?callback_url=${callbackUrl}`;
	
	vscode.postMessage({
		command: WebviewMessages.openSignupPage,
		url: signupUrl,
	});
}

