/**
 * Command IDs used throughout the extension
 */
export const Commands = {
	showView: 'clive.showView',
	helloWorld: 'clive.helloWorld',
	setupCypress: 'clive.setupCypress',
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
	setupCypress: 'setup-cypress',
	cypressStatus: 'cypress-status',
	setupStart: 'setup-start',
	setupError: 'setup-error',
	themeInfo: 'theme-info',
	themeChange: 'theme-change',
} as const;

