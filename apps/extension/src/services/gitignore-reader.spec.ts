import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
	findGitignoreFiles,
	getGitignorePatternsForCypress,
} from './gitignore-reader';

describe('gitignore-reader', () => {
	const tempDir = path.join(__dirname, '../../.test-temp-gitignore');

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

	describe('findGitignoreFiles', () => {
		it('should find gitignore files in workspace', async () => {
			// Create a test workspace structure
			const workspaceRoot = vscode.Uri.file(tempDir);
			const gitignorePath = path.join(tempDir, '.gitignore');
			fs.writeFileSync(gitignorePath, 'node_modules\n');

			// Set workspace folders for asRelativePath to work
			vscode.workspace.workspaceFolders = [{ uri: workspaceRoot }];

			// Mock vscode.workspace.findFiles
			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
				vscode.Uri.file(gitignorePath),
			]);

			const result = await findGitignoreFiles(workspaceRoot);
			expect(result).toContain('.gitignore');

			vi.restoreAllMocks();
			vscode.workspace.workspaceFolders = undefined as any;
		});

		it('should return empty array when no gitignore files exist', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([]);

			const result = await findGitignoreFiles(workspaceRoot);
			expect(result).toEqual([]);

			vi.restoreAllMocks();
		});
	});

	describe('getGitignorePatternsForCypress', () => {
		it('should parse gitignore patterns and convert to Cypress patterns', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);
			const gitignorePath = path.join(tempDir, '.gitignore');
			const gitignoreContent = [
				'node_modules',
				'.next',
				'dist/',
				'build',
				'# This is a comment',
				'',
				'*.log',
			].join('\n');
			fs.writeFileSync(gitignorePath, gitignoreContent);

			// Set workspace folders for asRelativePath to work
			vscode.workspace.workspaceFolders = [{ uri: workspaceRoot }];

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
				vscode.Uri.file(gitignorePath),
			]);

			const result = await getGitignorePatternsForCypress(workspaceRoot);

			// Should include patterns but not comments or empty lines
			expect(result).toContain('node_modules');
			expect(result).toContain('.next/**');
			expect(result).toContain('dist/**');
			expect(result).toContain('build/**');
			expect(result).toContain('*.log');
			// Should not contain comments
			expect(result.some((p) => p.includes('comment'))).toBe(false);

			vi.restoreAllMocks();
			vscode.workspace.workspaceFolders = undefined as any;
		});

		it('should handle directory patterns ending with /', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);
			const gitignorePath = path.join(tempDir, '.gitignore');
			fs.writeFileSync(gitignorePath, 'apps/nextjs/.next/\n');

			// Set workspace folders for asRelativePath to work
			vscode.workspace.workspaceFolders = [{ uri: workspaceRoot }];

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
				vscode.Uri.file(gitignorePath),
			]);

			const result = await getGitignorePatternsForCypress(workspaceRoot);

			expect(result.some((p) => p.includes('.next'))).toBe(true);

			vi.restoreAllMocks();
			vscode.workspace.workspaceFolders = undefined as any;
		});

		it('should handle patterns with leading slashes', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);
			const gitignorePath = path.join(tempDir, '.gitignore');
			fs.writeFileSync(gitignorePath, '/dist\n/.next\n');

			// Set workspace folders for asRelativePath to work
			vscode.workspace.workspaceFolders = [{ uri: workspaceRoot }];

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
				vscode.Uri.file(gitignorePath),
			]);

			const result = await getGitignorePatternsForCypress(workspaceRoot);

			// Leading slashes should be removed
			expect(result.some((p) => p.startsWith('/'))).toBe(false);
			expect(result.some((p) => p.includes('dist'))).toBe(true);
			expect(result.some((p) => p.includes('.next'))).toBe(true);

			vi.restoreAllMocks();
			vscode.workspace.workspaceFolders = undefined as any;
		});

		it('should skip negation patterns', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);
			const gitignorePath = path.join(tempDir, '.gitignore');
			fs.writeFileSync(gitignorePath, '*.log\n!important.log\n');

			// Set workspace folders for asRelativePath to work
			vscode.workspace.workspaceFolders = [{ uri: workspaceRoot }];

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
				vscode.Uri.file(gitignorePath),
			]);

			const result = await getGitignorePatternsForCypress(workspaceRoot);

			expect(result).toContain('*.log');
			expect(result.some((p) => p.includes('!important'))).toBe(false);

			vi.restoreAllMocks();
			vscode.workspace.workspaceFolders = undefined as any;
		});

		it('should return empty array when no gitignore files exist', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([]);

			const result = await getGitignorePatternsForCypress(workspaceRoot);
			expect(result).toEqual([]);

			vi.restoreAllMocks();
		});

		it('should handle multiple gitignore files', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);
			const rootGitignore = path.join(tempDir, '.gitignore');
			const packageGitignore = path.join(tempDir, 'apps', 'nextjs', '.gitignore');
			fs.mkdirSync(path.dirname(packageGitignore), { recursive: true });

			fs.writeFileSync(rootGitignore, 'node_modules\n');
			fs.writeFileSync(packageGitignore, '.next\n');

			// Set workspace folders for asRelativePath to work
			vscode.workspace.workspaceFolders = [{ uri: workspaceRoot }];

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
				vscode.Uri.file(rootGitignore),
				vscode.Uri.file(packageGitignore),
			]);

			const result = await getGitignorePatternsForCypress(workspaceRoot);

			expect(result).toContain('node_modules');
			expect(result.some((p) => p.includes('.next'))).toBe(true);

			vi.restoreAllMocks();
			vscode.workspace.workspaceFolders = undefined as any;
		});

		it('should remove duplicate patterns', async () => {
			const workspaceRoot = vscode.Uri.file(tempDir);
			const gitignorePath = path.join(tempDir, '.gitignore');
			fs.writeFileSync(gitignorePath, 'node_modules\nnode_modules\n');

			// Set workspace folders for asRelativePath to work
			vscode.workspace.workspaceFolders = [{ uri: workspaceRoot }];

			vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
				vscode.Uri.file(gitignorePath),
			]);

			const result = await getGitignorePatternsForCypress(workspaceRoot);

			const nodeModulesCount = result.filter((p) => p === 'node_modules').length;
			expect(nodeModulesCount).toBe(1);

			vi.restoreAllMocks();
			vscode.workspace.workspaceFolders = undefined as any;
		});
	});
});

