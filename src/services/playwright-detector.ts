import * as vscode from 'vscode';
import { Effect, pipe } from 'effect';

export interface PackageInfo {
	name: string;
	path: string;
	relativePath: string;
	hasPlaywrightPackage: boolean;
	hasPlaywrightConfig: boolean;
	isConfigured: boolean;
}

export interface PlaywrightStatus {
	overallStatus: 'installed' | 'not_installed' | 'partial';
	packages: PackageInfo[];
	workspaceRoot: string;
}

/**
 * Check Playwright installation status across all packages in the workspace
 */
export async function checkPlaywrightStatus(): Promise<PlaywrightStatus | null> {
	return pipe(
		Effect.sync(() => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return null;
			}

			// For now, use the first workspace folder
			// TODO: Support multiple workspace folders
			const workspaceRoot = workspaceFolders[0].uri;
			return workspaceRoot;
		}),
		Effect.flatMap((workspaceRoot) => {
			if (!workspaceRoot) {
				return Effect.succeed(null);
			}

			return Effect.promise(async () => {
				// Find all package.json files excluding node_modules
				const packageJsonFiles = await vscode.workspace.findFiles(
					'**/package.json',
					'**/node_modules/**'
				);

				if (packageJsonFiles.length === 0) {
					return {
						overallStatus: 'not_installed' as const,
						packages: [],
						workspaceRoot: workspaceRoot.fsPath,
					};
				}

				const packages: PackageInfo[] = [];

				for (const packageJsonUri of packageJsonFiles) {
					const packageInfo = await checkPackage(
						packageJsonUri,
						workspaceRoot
					);
					if (packageInfo) {
						packages.push(packageInfo);
					}
				}

				// Determine overall status
				const configuredCount = packages.filter((p) => p.isConfigured).length;
				const totalCount = packages.length;
				let overallStatus: 'installed' | 'not_installed' | 'partial';
				if (configuredCount === 0) {
					overallStatus = 'not_installed';
				} else if (configuredCount === totalCount) {
					overallStatus = 'installed';
				} else {
					overallStatus = 'partial';
				}

				return {
					overallStatus,
					packages,
					workspaceRoot: workspaceRoot.fsPath,
				};
			});
		}),
		Effect.runPromise
	);
}

/**
 * Check a single package.json for Playwright installation
 */
async function checkPackage(
	packageJsonUri: vscode.Uri,
	_workspaceRoot: vscode.Uri
): Promise<PackageInfo | null> {
	try {
			// Read package.json
			const packageJsonContent = await vscode.workspace.fs.readFile(
				packageJsonUri
			);
			const packageJson = JSON.parse(
				Buffer.from(packageJsonContent).toString('utf-8')
			);

			const packageName = packageJson.name || 'unknown';
			const packageDir = vscode.Uri.joinPath(packageJsonUri, '..');
			const relativePath = vscode.workspace.asRelativePath(packageDir);

			// Check for @playwright/test in dependencies or devDependencies
			const hasPlaywrightPackage =
				packageJson.dependencies?.['@playwright/test'] ||
				packageJson.devDependencies?.['@playwright/test']
					? true
					: false;

			// Check for playwright config files
			const configFiles = [
				'playwright.config.ts',
				'playwright.config.js',
				'playwright.config.mjs',
			];

			let hasPlaywrightConfig = false;
			for (const configFile of configFiles) {
				try {
					const configUri = vscode.Uri.joinPath(packageDir, configFile);
					await vscode.workspace.fs.stat(configUri);
					hasPlaywrightConfig = true;
					break;
				} catch {
					// File doesn't exist, continue
				}
			}

			const isConfigured = hasPlaywrightPackage && hasPlaywrightConfig;

		return {
			name: packageName,
			path: packageDir.fsPath,
			relativePath,
			hasPlaywrightPackage,
			hasPlaywrightConfig,
			isConfigured,
		};
	} catch (error) {
		console.error(`Error checking package at ${packageJsonUri.fsPath}:`, error);
		return null;
	}
}

