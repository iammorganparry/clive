import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Effect, pipe } from 'effect';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export interface SetupOptions {
	targetDirectory: string;
	packageManager?: PackageManager;
}

/**
 * Set up Playwright in the target directory
 */
export async function setupPlaywright(options: SetupOptions): Promise<void> {
		return pipe(
			Effect.sync(() => {
				const targetDir = options.targetDirectory;
				const packageManager =
					options.packageManager || detectPackageManager(targetDir);

				return { targetDir, packageManager };
			}),
			Effect.flatMap(({ targetDir, packageManager }) => {
				return Effect.promise(async () => {
					const command = getInitCommand(packageManager);
					const cwd = targetDir;

					// Show progress notification
					vscode.window.showInformationMessage(
						`Setting up Playwright in ${path.basename(targetDir)}...`
					);

					// Create terminal and run command
					const terminal = vscode.window.createTerminal({
						name: 'Clive: Playwright Setup',
						cwd,
					});

					terminal.show(true);
					terminal.sendText(command);

					// Wait for terminal to be created and command to be sent
					await new Promise((resolve) => setTimeout(resolve, 500));

					// Note: We don't wait for the command to complete here
					// The user can see the terminal output and we'll re-check status later
				});
			}),
			Effect.runPromise
		);
	}

	/**
	 * Detect package manager from lock files
	 */
function detectPackageManager(targetDirectory: string): PackageManager {
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
function getInitCommand(packageManager: PackageManager): string {
		switch (packageManager) {
			case 'yarn':
				return 'yarn create playwright --yes';
			case 'pnpm':
				return 'pnpm create playwright --yes';
			case 'npm':
			default:
				return 'npm init playwright@latest -- --yes';
		}
	}

