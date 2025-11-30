import { WebviewMessages } from "../../constants.js";
import type { VSCodeAPI } from "./vscode.js";

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

const BRAND = "🔬 Clive";
const PREFIX = `[${BRAND}]`;

/**
 * Format log message with branding
 */
function formatMessage(level: LogLevel): string {
	const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
	const levelEmoji = {
		log: "📝",
		info: "ℹ️",
		warn: "⚠️",
		error: "❌",
		debug: "🐛",
	}[level];

	const levelLabel = level.toUpperCase().padEnd(5);
	return `${PREFIX} ${levelEmoji} [${timestamp}] [${levelLabel}]`;
}

/**
 * Send log to output channel via VSCode API
 */
function sendToOutputChannel(
	vscode: VSCodeAPI,
	level: LogLevel,
	message: string,
	data?: unknown
): void {
	vscode.postMessage({
		command: WebviewMessages.log,
		data: {
			level,
			message: `${message}${data ? `: ${JSON.stringify(data, null, 2)}` : ""}`,
			data,
		},
	});
}

/**
 * Logger service for webview
 */
export class Logger {
	constructor(private vscode: VSCodeAPI) {}

	log(message: string, ...args: unknown[]): void {
		const formattedPrefix = formatMessage("log");
		console.log(formattedPrefix, message, ...args);

		const data = args.length > 0 ? (args.length === 1 ? args[0] : args) : undefined;
		sendToOutputChannel(this.vscode, "log", message, data);
	}

	info(message: string, ...args: unknown[]): void {
		const formattedPrefix = formatMessage("info");
		console.info(formattedPrefix, message, ...args);

		const data = args.length > 0 ? (args.length === 1 ? args[0] : args) : undefined;
		sendToOutputChannel(this.vscode, "info", message, data);
	}

	warn(message: string, ...args: unknown[]): void {
		const formattedPrefix = formatMessage("warn");
		console.warn(formattedPrefix, message, ...args);

		const data = args.length > 0 ? (args.length === 1 ? args[0] : args) : undefined;
		sendToOutputChannel(this.vscode, "warn", message, data);
	}

	error(message: string, ...args: unknown[]): void {
		const formattedPrefix = formatMessage("error");
		console.error(formattedPrefix, message, ...args);

		const data = args.length > 0 ? (args.length === 1 ? args[0] : args) : undefined;
		sendToOutputChannel(this.vscode, "error", message, data);
	}

	debug(message: string, ...args: unknown[]): void {
		const formattedPrefix = formatMessage("debug");
		console.log(formattedPrefix, message, ...args);

		const data = args.length > 0 ? (args.length === 1 ? args[0] : args) : undefined;
		sendToOutputChannel(this.vscode, "debug", message, data);
	}

	component = {
		mount: (componentName: string) => {
			console.log(`${PREFIX} 🎯 [MOUNT] ${componentName}`);
			sendToOutputChannel(this.vscode, "info", `Component mounted: ${componentName}`);
		},
		render: (componentName: string, props?: Record<string, unknown>) => {
			console.log(`${PREFIX} 🎨 [RENDER] ${componentName}`, props || "");
			sendToOutputChannel(this.vscode, "debug", `Component rendered: ${componentName}`, props);
		},
		unmount: (componentName: string) => {
			console.log(`${PREFIX} 🚪 [UNMOUNT] ${componentName}`);
			sendToOutputChannel(this.vscode, "info", `Component unmounted: ${componentName}`);
		},
	};

	query = {
		start: (queryKey: string) => {
			console.log(`${PREFIX} 🔍 [QUERY START] ${queryKey}`);
			sendToOutputChannel(this.vscode, "debug", `Query started: ${queryKey}`);
		},
		success: (queryKey: string, data?: unknown) => {
			console.log(`${PREFIX} ✅ [QUERY SUCCESS] ${queryKey}`, data || "");
			sendToOutputChannel(this.vscode, "debug", `Query succeeded: ${queryKey}`, data);
		},
		error: (queryKey: string, error: unknown) => {
			console.error(`${PREFIX} ❌ [QUERY ERROR] ${queryKey}`, error);
			sendToOutputChannel(this.vscode, "error", `Query error: ${queryKey}`, error);
		},
	};

	message = {
		send: (command: string, data?: unknown) => {
			console.log(`${PREFIX} 📤 [MESSAGE SEND] ${command}`, data || "");
			sendToOutputChannel(this.vscode, "debug", `Message sent: ${command}`, data);
		},
		receive: (command: string, data?: unknown) => {
			console.log(`${PREFIX} 📥 [MESSAGE RECEIVE] ${command}`, data || "");
			sendToOutputChannel(this.vscode, "debug", `Message received: ${command}`, data);
		},
	};
}

// Singleton logger instance
let loggerInstance: Logger | null = null;

/**
 * Initialize logger instance
 */
export function initLogger(vscode: VSCodeAPI): Logger {
	if (!loggerInstance) {
		loggerInstance = new Logger(vscode);
	}
	return loggerInstance;
}

/**
 * Get logger instance (fallback to console if not initialized)
 */
export function getLogger(): Logger {
	if (!loggerInstance) {
		// Create a fallback logger that only uses console
		return {
			log: (message: string, ...args: unknown[]) => {
				const formattedPrefix = formatMessage("log");
				console.log(formattedPrefix, message, ...args);
			},
			info: (message: string, ...args: unknown[]) => {
				const formattedPrefix = formatMessage("info");
				console.info(formattedPrefix, message, ...args);
			},
			warn: (message: string, ...args: unknown[]) => {
				const formattedPrefix = formatMessage("warn");
				console.warn(formattedPrefix, message, ...args);
			},
			error: (message: string, ...args: unknown[]) => {
				const formattedPrefix = formatMessage("error");
				console.error(formattedPrefix, message, ...args);
			},
			debug: (message: string, ...args: unknown[]) => {
				const formattedPrefix = formatMessage("debug");
				console.log(formattedPrefix, message, ...args);
			},
			component: {
				mount: (componentName: string) => {
					console.log(`${PREFIX} 🎯 [MOUNT] ${componentName}`);
				},
				render: (componentName: string, props?: Record<string, unknown>) => {
					console.log(`${PREFIX} 🎨 [RENDER] ${componentName}`, props || "");
				},
				unmount: (componentName: string) => {
					console.log(`${PREFIX} 🚪 [UNMOUNT] ${componentName}`);
				},
			},
			query: {
				start: (queryKey: string) => {
					console.log(`${PREFIX} 🔍 [QUERY START] ${queryKey}`);
				},
				success: (queryKey: string, data?: unknown) => {
					console.log(`${PREFIX} ✅ [QUERY SUCCESS] ${queryKey}`, data || "");
				},
				error: (queryKey: string, error: unknown) => {
					console.error(`${PREFIX} ❌ [QUERY ERROR] ${queryKey}`, error);
				},
			},
			message: {
				send: (command: string, data?: unknown) => {
					console.log(`${PREFIX} 📤 [MESSAGE SEND] ${command}`, data || "");
				},
				receive: (command: string, data?: unknown) => {
					console.log(`${PREFIX} 📥 [MESSAGE RECEIVE] ${command}`, data || "");
				},
			},
		} as Logger;
	}
	return loggerInstance;
}

// Export convenience logger object
export const logger = {
	get log() {
		return getLogger().log.bind(getLogger());
	},
	get info() {
		return getLogger().info.bind(getLogger());
	},
	get warn() {
		return getLogger().warn.bind(getLogger());
	},
	get error() {
		return getLogger().error.bind(getLogger());
	},
	get debug() {
		return getLogger().debug.bind(getLogger());
	},
	get component() {
		return getLogger().component;
	},
	get query() {
		return getLogger().query;
	},
	get message() {
		return getLogger().message;
	},
};
