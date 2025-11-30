import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { GitignoreReader } from './gitignore-reader.js';
import { CypressConfigUpdater } from './cypress-config-updater.js';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export interface SetupOptions {
	targetDirectory: string;
	packageManager?: PackageManager;
}

/**
 * Service for setting up Cypress in a project
 */
export class CypressSetup {
	private gitignoreReader: GitignoreReader;
	private configUpdater: CypressConfigUpdater;

	constructor() {
		this.gitignoreReader = new GitignoreReader();
		this.configUpdater = new CypressConfigUpdater();
	}

	/**
	 * Poll for Cypress config file to appear
	 */
	private async pollForConfigFile(
		targetDirectory: string,
		timeoutMs: number = 30000,
		intervalMs: number = 500
	): Promise<string | null> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			const configPath = await this.configUpdater.findConfig(targetDirectory);
			if (configPath) {
				return configPath;
			}
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}

		return null;
	}

	/**
	 * Set up Cypress in the target directory
	 */
	async setup(options: SetupOptions): Promise<void> {
		const targetDir = options.targetDirectory;
		const packageManager =
			options.packageManager || this.detectPackageManager(targetDir);

		const command = this.getInitCommand(packageManager);
		const cwd = targetDir;

		// Show progress notification
		vscode.window.showInformationMessage(
			`Setting up Cypress in ${path.basename(targetDir)}...`
		);

		// Create terminal and run command
		const terminal = vscode.window.createTerminal({
			name: 'Clive: Cypress Setup',
			cwd,
		});

		terminal.show(true);
		terminal.sendText(command);

		// Wait for terminal to be created and command to be sent
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Poll for config file to appear
		const configPath = await this.pollForConfigFile(targetDir);

		if (configPath) {
			// Get gitignore patterns and update config
			try {
				const workspaceRoot =
					vscode.workspace.workspaceFolders?.[0]?.uri;
				if (workspaceRoot) {
					const gitignorePatterns =
						await this.gitignoreReader.getGitignorePatternsForCypress(
							workspaceRoot
						);

					if (gitignorePatterns.length > 0) {
						await this.configUpdater.updateConfig(
							targetDir,
							gitignorePatterns
						);

						vscode.window.showInformationMessage(
							`Cypress configured with ${gitignorePatterns.length} gitignore patterns`
						);
					}
				}
			} catch (error) {
				// Log error but don't fail the setup
				console.error(
					'Failed to update Cypress config with gitignore patterns:',
					error
				);
			}
		}

		// Note: We don't wait for the command to complete here
		// The user can see the terminal output and we'll re-check status later
	}

	/**
	 * Detect package manager from lock files
	 */
	private detectPackageManager(targetDirectory: string): PackageManager {
		let currentDir = targetDirectory;

		// Walk up the directory tree to find lock files
		for (let i = 0; i < 10; i++) {
			try {
				const yarnLock = path.join(currentDir, 'yarn.lock');
				const pnpmLock = path.join(currentDir, 'pnpm-lock.yaml');
				const npmLock = path.join(currentDir, 'package-lock.json');

				if (fs.existsSync(yarnLock)) {
					return 'yarn';
				}
				if (fs.existsSync(pnpmLock)) {
					return 'pnpm';
				}
				if (fs.existsSync(npmLock)) {
					return 'npm';
				}

				// Move up one directory
				const parentDir = path.dirname(currentDir);
				if (parentDir === currentDir) {
					// Reached root, stop searching
					break;
				}
				currentDir = parentDir;
			} catch {
				// If we can't access the directory, break
				break;
			}
		}

		// Default to npm if no lock file found
		return 'npm';
	}

	/**
	 * Get the init command for the package manager
	 */
	private getInitCommand(packageManager: PackageManager): string {
		switch (packageManager) {
			case 'yarn':
				return 'yarn add cypress -D && npx cypress open --e2e --browser electron';
			case 'pnpm':
				return 'pnpm add -D cypress && npx cypress open --e2e --browser electron';
			default:
				return 'npm install cypress --save-dev && npx cypress open --e2e --browser electron';
		}
	}
}

// Export convenience function for backward compatibility
export async function setupCypress(options: SetupOptions): Promise<void> {
	const setup = new CypressSetup();
	return setup.setup(options);
}
