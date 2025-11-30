import * as vscode from 'vscode';
import * as path from 'path';
import { Effect, pipe } from 'effect';

/**
 * Find all .gitignore files in the workspace
 * Returns paths relative to workspace root
 */
export async function findGitignoreFiles(
	workspaceRoot: vscode.Uri
): Promise<string[]> {
	const gitignoreFiles = await vscode.workspace.findFiles(
		'**/.gitignore',
		'**/node_modules/**'
	);

	return gitignoreFiles.map((uri) =>
		vscode.workspace.asRelativePath(uri, false)
	);
}

/**
 * Read and parse a gitignore file
 */
async function readGitignoreFile(
	gitignorePath: string,
	workspaceRoot: vscode.Uri
): Promise<string[]> {
	const fullPath = vscode.Uri.joinPath(workspaceRoot, gitignorePath);
	const content = await vscode.workspace.fs.readFile(fullPath);
	const text = Buffer.from(content).toString('utf-8');

	// Parse gitignore patterns
	const lines = text.split('\n');
	const patterns: string[] = [];

	for (const line of lines) {
		// Remove comments and empty lines
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		// Remove leading ! (negation patterns - we'll handle these separately if needed)
		// For now, we'll include all ignore patterns
		if (trimmed.startsWith('!')) {
			continue; // Skip negation patterns for now
		}

		patterns.push(trimmed);
	}

	return patterns;
}

/**
 * Convert gitignore patterns to Cypress excludeSpecPattern glob patterns
 * Cypress uses glob patterns, so we need to convert gitignore patterns appropriately
 */
function convertToCypressPatterns(
	gitignorePatterns: string[],
	gitignoreDir: string
): string[] {
	const cypressPatterns: string[] = [];

	for (const pattern of gitignorePatterns) {
		// Skip empty patterns
		if (!pattern) {
			continue;
		}

		// Handle directory patterns
		// If pattern ends with /, it's a directory
		// If pattern doesn't have a /, it could be a file or directory
		let cypressPattern = pattern;

		// Remove leading slash (gitignore patterns are relative to the gitignore file location)
		if (cypressPattern.startsWith('/')) {
			cypressPattern = cypressPattern.slice(1);
		}

		// If pattern ends with /, add ** to match all files in directory
		if (cypressPattern.endsWith('/')) {
			cypressPattern = `${cypressPattern}**`;
		} else if (!cypressPattern.includes('*')) {
			// If it's a simple pattern without wildcards, check if it's likely a directory
			// Common build directories that should be ignored
			const commonDirs = [
				'.next',
				'dist',
				'build',
				'out',
				'.cache',
				'coverage',
				'.turbo',
				'.vercel',
			];
			if (commonDirs.includes(cypressPattern)) {
				cypressPattern = `${cypressPattern}/**`;
			}
		}

		// Prepend the gitignore directory path if it's not at root
		if (gitignoreDir && gitignoreDir !== '.') {
			const gitignoreParent = path.dirname(gitignoreDir);
			if (gitignoreParent !== '.') {
				cypressPattern = path.join(gitignoreParent, cypressPattern);
			}
		}

		// Normalize path separators
		cypressPattern = cypressPattern.replace(/\\/g, '/');

		cypressPatterns.push(cypressPattern);
	}

	return cypressPatterns;
}

/**
 * Get all gitignore patterns from workspace and convert to Cypress excludeSpecPattern patterns
 */
export async function getGitignorePatternsForCypress(
	workspaceRoot: vscode.Uri
): Promise<string[]> {
	return pipe(
		Effect.sync(() => workspaceRoot),
		Effect.flatMap((root) =>
			Effect.promise(async () => {
				const gitignoreFiles = await findGitignoreFiles(root);

				if (gitignoreFiles.length === 0) {
					return [];
				}

				const allPatterns: string[] = [];

				for (const gitignoreFile of gitignoreFiles) {
					try {
						const patterns = await readGitignoreFile(
							gitignoreFile,
							root
						);
						const cypressPatterns = convertToCypressPatterns(
							patterns,
							gitignoreFile
						);
						allPatterns.push(...cypressPatterns);
					} catch (error) {
						// If we can't read a gitignore file, skip it
						console.warn(
							`Failed to read gitignore file ${gitignoreFile}:`,
							error
						);
					}
				}

				// Remove duplicates
				return Array.from(new Set(allPatterns));
			})
		),
		Effect.runPromise
	);
}

