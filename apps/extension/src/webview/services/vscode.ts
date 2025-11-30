export interface VSCodeAPI {
	readonly postMessage: (message: unknown) => void;
	readonly getState: () => unknown;
	readonly setState: (state: unknown) => void;
}

/**
 * Acquire VS Code API (only call this once per webview)
 */
declare const acquireVsCodeApi: () => VSCodeAPI;

// Store the singleton instance
let vscodeInstance: VSCodeAPI | null = null;

/**
 * Get or acquire the VS Code API instance
 * This ensures acquireVsCodeApi() is only called once
 */
export function getVSCodeAPI(): VSCodeAPI {
	if (!vscodeInstance) {
		vscodeInstance = acquireVsCodeApi();
	}
	return vscodeInstance;
}
