import * as vscode from 'vscode';
import { Effect, pipe } from 'effect';

/**
 * Cypress config file names (in order of preference)
 */
const CONFIG_FILES = [
	'cypress.config.ts',
	'cypress.config.js',
	'cypress.config.mjs',
] as const;

/**
 * Find the Cypress config file in a directory
 */
export async function findCypressConfig(
	targetDirectory: string
): Promise<string | null> {
	const dirUri = vscode.Uri.file(targetDirectory);

	for (const configFile of CONFIG_FILES) {
		const configPath = vscode.Uri.joinPath(dirUri, configFile);
		try {
			await vscode.workspace.fs.stat(configPath);
			return configPath.fsPath;
		} catch {
			// File doesn't exist, try next
			continue;
		}
	}

	return null;
}

/**
 * Read Cypress config file content
 */
async function readConfigFile(configPath: string): Promise<string> {
	const uri = vscode.Uri.file(configPath);
	const content = await vscode.workspace.fs.readFile(uri);
	return Buffer.from(content).toString('utf-8');
}

/**
 * Write Cypress config file content
 */
async function writeConfigFile(
	configPath: string,
	content: string
): Promise<void> {
	const uri = vscode.Uri.file(configPath);
	const buffer = Buffer.from(content, 'utf-8');
	await vscode.workspace.fs.writeFile(uri, buffer);
}

/**
 * Update Cypress config to include excludeSpecPattern in e2e config
 * This function uses string manipulation to preserve the existing config structure
 */
function updateConfigContent(
	configContent: string,
	excludeSpecPatterns: string[]
): string {
	// Check if excludeSpecPattern already exists in e2e config
	const e2eExcludeRegex =
		/e2e\s*:\s*\{([\s\S]*?)\}/;
	const e2eMatch = configContent.match(e2eExcludeRegex);

	if (e2eMatch) {
		const e2eContent = e2eMatch[1];
		const excludeRegex =
			/excludeSpecPattern\s*[:=]\s*(\[[\s\S]*?\]|\([\s\S]*?\))/;
		const existingMatch = e2eContent.match(excludeRegex);

		if (existingMatch) {
			// Extract existing patterns
			const existingPatternsStr = existingMatch[1];
			// Parse existing patterns (simple regex-based parsing)
			const existingPatternsMatch = existingPatternsStr.match(
				/['"`]([^'"`]+)['"`]/g
			);
			const existingPatterns = existingPatternsMatch
				? existingPatternsMatch.map((p) =>
						p.slice(1, -1).replace(/\\/g, '')
					)
				: [];

			// Merge patterns and remove duplicates
			const mergedPatterns = Array.from(
				new Set([...existingPatterns, ...excludeSpecPatterns])
			);

			// Replace existing excludeSpecPattern
			const newPatternsStr = mergedPatterns
				.map((p) => `    '${p.replace(/'/g, "\\'")}'`)
				.join(',\n');
			const newExcludeSpecPattern = `excludeSpecPattern: [\n${newPatternsStr},\n  ]`;

			return configContent.replace(
				e2eExcludeRegex,
				`e2e: {${e2eContent.replace(excludeRegex, newExcludeSpecPattern)}}`
			);
		}

		// excludeSpecPattern doesn't exist in e2e, add it
		const patternsStr = excludeSpecPatterns
			.map((p) => `    '${p.replace(/'/g, "\\'")}'`)
			.join(',\n');
		const excludeSpecPatternProperty = `  excludeSpecPattern: [\n${patternsStr},\n  ],`;

		// Insert excludeSpecPattern after the opening brace or after the first property
		const lines = e2eContent.split('\n');
		const insertIndex = lines.findIndex(
			(line) => line.trim() && !line.trim().startsWith('//')
		);

		if (insertIndex >= 0) {
			lines.splice(insertIndex + 1, 0, excludeSpecPatternProperty);
			const newE2eContent = lines.join('\n');
			return configContent.replace(
				e2eExcludeRegex,
				`e2e: {\n${newE2eContent}\n}`
			);
		}

		// Fallback: append to the end of the e2e config object
		const newE2eContent = `${e2eContent}\n${excludeSpecPatternProperty}`;
		return configContent.replace(
			e2eExcludeRegex,
			`e2e: {\n${newE2eContent}\n}`
		);
	}

	// e2e config doesn't exist, add it with excludeSpecPattern
	// Find the defineConfig call and add e2e config inside it
	const defineConfigRegex = /defineConfig\s*\(\s*\{([\s\S]*?)\}\s*\)/;
	const defineConfigMatch = configContent.match(defineConfigRegex);

	if (defineConfigMatch) {
		const configObject = defineConfigMatch[1];
		const patternsStr = excludeSpecPatterns
			.map((p) => `    '${p.replace(/'/g, "\\'")}'`)
			.join(',\n');
		const e2eConfigProperty = `  e2e: {\n    excludeSpecPattern: [\n${patternsStr},\n    ],\n  },`;

		// Insert e2e config after the opening brace or after the first property
		const lines = configObject.split('\n');
		const insertIndex = lines.findIndex(
			(line) => line.trim() && !line.trim().startsWith('//')
		);

		if (insertIndex >= 0) {
			lines.splice(insertIndex + 1, 0, e2eConfigProperty);
			const newConfigObject = lines.join('\n');
			return configContent.replace(
				defineConfigRegex,
				`defineConfig({\n${newConfigObject}\n})`
			);
		}

		// Fallback: append to the end of the config object
		const newConfigObject = `${configObject}\n${e2eConfigProperty}`;
		return configContent.replace(
			defineConfigRegex,
			`defineConfig({\n${newConfigObject}\n})`
		);
	}

	// If we can't find defineConfig, try to add it to export default
	const exportDefaultRegex = /export\s+default\s+defineConfig\s*\(\s*\{([\s\S]*?)\}\s*\)/;
	const exportDefaultMatch = configContent.match(exportDefaultRegex);

	if (exportDefaultMatch) {
		const configObject = exportDefaultMatch[1];
		const patternsStr = excludeSpecPatterns
			.map((p) => `    '${p.replace(/'/g, "\\'")}'`)
			.join(',\n');
		const e2eConfigProperty = `  e2e: {\n    excludeSpecPattern: [\n${patternsStr},\n    ],\n  },`;

		const lines = configObject.split('\n');
		const insertIndex = lines.findIndex(
			(line) => line.trim() && !line.trim().startsWith('//')
		);

		if (insertIndex >= 0) {
			lines.splice(insertIndex + 1, 0, e2eConfigProperty);
			const newConfigObject = lines.join('\n');
			return configContent.replace(
				exportDefaultRegex,
				`export default defineConfig({\n${newConfigObject}\n})`
			);
		}

		const newConfigObject = `${configObject}\n${e2eConfigProperty}`;
		return configContent.replace(
			exportDefaultRegex,
			`export default defineConfig({\n${newConfigObject}\n})`
		);
	}

	// Last resort: append at the end of the file before the last closing brace
	const patternsStr = excludeSpecPatterns
		.map((p) => `    '${p.replace(/'/g, "\\'")}'`)
		.join(',\n');
	const e2eConfig = `\n  e2e: {\n    excludeSpecPattern: [\n${patternsStr},\n    ],\n  },\n`;
	return configContent.replace(/\}\s*$/, `${e2eConfig}}`);
}

/**
 * Update Cypress config file with excludeSpecPattern patterns
 */
export async function updateCypressConfig(
	targetDirectory: string,
	excludeSpecPatterns: string[]
): Promise<void> {
	if (excludeSpecPatterns.length === 0) {
		return;
	}

	return pipe(
		Effect.sync(() => targetDirectory),
		Effect.flatMap((dir) =>
			Effect.promise(async () => {
				const configPath = await findCypressConfig(dir);

				if (!configPath) {
					throw new Error(
						`No Cypress config file found in ${dir}`
					);
				}

				const configContent = await readConfigFile(configPath);
				const updatedContent = updateConfigContent(
					configContent,
					excludeSpecPatterns
				);
				await writeConfigFile(configPath, updatedContent);
			})
		),
		Effect.runPromise
	);
}

