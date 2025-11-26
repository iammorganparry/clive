/**
 * Command IDs used throughout the extension
 */
export const Commands = {
	showView: 'clive.showView',
	helloWorld: 'clive.helloWorld',
	setupPlaywright: 'clive.setupPlaywright',
} as const;

/**
 * View IDs used throughout the extension
 */
export const Views = {
	mainView: 'clive.mainView',
	viewContainer: 'clive',
} as const;

/**
 * Webview message commands for communication between extension and webview
 */
export const WebviewMessages = {
	ready: 'ready',
	refreshStatus: 'refresh-status',
	setupPlaywright: 'setup-playwright',
	playwrightStatus: 'playwright-status',
	setupStart: 'setup-start',
	setupError: 'setup-error',
} as const;

