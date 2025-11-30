import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./src/test/setup.ts'],
		include: ['src/**/*.spec.ts'],
		exclude: ['node_modules', 'dist', 'out', 'src/test/**'],
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
			'vscode': path.resolve(__dirname, 'src/test/vscode-mock.ts'),
		},
	},
	esbuild: {
		target: 'node18',
	},
});

