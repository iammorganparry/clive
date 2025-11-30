import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
	findCypressConfig,
	updateCypressConfig,
} from './cypress-config-updater';

describe('cypress-config-updater', () => {
	const tempDir = path.join(__dirname, '../../.test-temp-config');

	beforeEach(() => {
		// Create temp directory for tests
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}
	});

	afterEach(() => {
		// Clean up temp directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe('findCypressConfig', () => {
		it('should find cypress.config.ts', async () => {
			const configPath = path.join(tempDir, 'cypress.config.ts');
			fs.writeFileSync(configPath, 'export default {};');

			const result = await findCypressConfig(tempDir);
			expect(result).toBe(configPath);
		});

		it('should find cypress.config.js when .ts does not exist', async () => {
			const configPath = path.join(tempDir, 'cypress.config.js');
			fs.writeFileSync(configPath, 'module.exports = {};');

			const result = await findCypressConfig(tempDir);
			expect(result).toBe(configPath);
		});

		it('should find cypress.config.mjs when others do not exist', async () => {
			const configPath = path.join(tempDir, 'cypress.config.mjs');
			fs.writeFileSync(configPath, 'export default {};');

			const result = await findCypressConfig(tempDir);
			expect(result).toBe(configPath);
		});

		it('should prefer .ts over .js', async () => {
			const tsPath = path.join(tempDir, 'cypress.config.ts');
			const jsPath = path.join(tempDir, 'cypress.config.js');
			fs.writeFileSync(tsPath, 'export default {};');
			fs.writeFileSync(jsPath, 'module.exports = {};');

			const result = await findCypressConfig(tempDir);
			expect(result).toBe(tsPath);
		});

		it('should return null when no config file exists', async () => {
			const result = await findCypressConfig(tempDir);
			expect(result).toBeNull();
		});
	});

	describe('updateCypressConfig', () => {
		it('should add excludeSpecPattern to e2e config without existing excludeSpecPattern', async () => {
			const configPath = path.join(tempDir, 'cypress.config.ts');
			const configContent = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
`;

			fs.writeFileSync(configPath, configContent);

			const patterns = ['node_modules/**', '.next/**'];
			await updateCypressConfig(tempDir, patterns);

			const updatedContent = fs.readFileSync(configPath, 'utf-8');
			expect(updatedContent).toContain('excludeSpecPattern');
			expect(updatedContent).toContain("'node_modules/**'");
			expect(updatedContent).toContain("'.next/**'");
		});

		it('should merge with existing excludeSpecPattern patterns', async () => {
			const configPath = path.join(tempDir, 'cypress.config.ts');
			const configContent = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    excludeSpecPattern: ['existing-pattern/**'],
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
`;

			fs.writeFileSync(configPath, configContent);

			const patterns = ['node_modules/**'];
			await updateCypressConfig(tempDir, patterns);

			const updatedContent = fs.readFileSync(configPath, 'utf-8');
			expect(updatedContent).toContain("'existing-pattern/**'");
			expect(updatedContent).toContain("'node_modules/**'");
		});

		it('should handle export default defineConfig syntax', async () => {
			const configPath = path.join(tempDir, 'cypress.config.ts');
			const configContent = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
`;

			fs.writeFileSync(configPath, configContent);

			const patterns = ['dist/**'];
			await updateCypressConfig(tempDir, patterns);

			const updatedContent = fs.readFileSync(configPath, 'utf-8');
			expect(updatedContent).toContain('excludeSpecPattern');
			expect(updatedContent).toContain("'dist/**'");
		});

		it('should not add excludeSpecPattern when patterns array is empty', async () => {
			const configPath = path.join(tempDir, 'cypress.config.ts');
			const configContent = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
`;

			fs.writeFileSync(configPath, configContent);

			await updateCypressConfig(tempDir, []);

			const updatedContent = fs.readFileSync(configPath, 'utf-8');
			expect(updatedContent).toBe(configContent);
		});

		it('should handle patterns with special characters', async () => {
			const configPath = path.join(tempDir, 'cypress.config.ts');
			const configContent = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
`;

			fs.writeFileSync(configPath, configContent);

			const patterns = ["apps/nextjs/.next/**", "*.log"];
			await updateCypressConfig(tempDir, patterns);

			const updatedContent = fs.readFileSync(configPath, 'utf-8');
			expect(updatedContent).toContain("'apps/nextjs/.next/**'");
			expect(updatedContent).toContain("'*.log'");
		});

		it('should throw error when config file does not exist', async () => {
			await expect(
				updateCypressConfig(tempDir, ['node_modules/**'])
			).rejects.toThrow();
		});

		it('should remove duplicate patterns when merging', async () => {
			const configPath = path.join(tempDir, 'cypress.config.ts');
			const configContent = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    excludeSpecPattern: ['node_modules/**'],
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
`;

			fs.writeFileSync(configPath, configContent);

			const patterns = ['node_modules/**', 'dist/**'];
			await updateCypressConfig(tempDir, patterns);

			const updatedContent = fs.readFileSync(configPath, 'utf-8');
			// Count occurrences of node_modules pattern
			const matches = updatedContent.match(/'node_modules\/\*\*'/g);
			expect(matches?.length).toBe(1);
			expect(updatedContent).toContain("'dist/**'");
		});
	});
});

