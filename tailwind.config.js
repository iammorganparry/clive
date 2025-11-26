/** @type {import('tailwindcss').Config} */
export default {
	content: [
		'./src/webview/**/*.{js,ts,jsx,tsx}',
	],
	theme: {
		extend: {
			colors: {
				// VS Code theme colors
				'vscode-foreground': 'var(--vscode-foreground)',
				'vscode-descriptionForeground': 'var(--vscode-descriptionForeground)',
				'vscode-errorForeground': 'var(--vscode-errorForeground)',
				'vscode-textLink-foreground': 'var(--vscode-textLink-foreground)',
				'vscode-textLink-activeForeground': 'var(--vscode-textLink-activeForeground)',
				'vscode-button-background': 'var(--vscode-button-background)',
				'vscode-button-foreground': 'var(--vscode-button-foreground)',
				'vscode-button-hoverBackground': 'var(--vscode-button-hoverBackground)',
				'vscode-input-background': 'var(--vscode-input-background)',
				'vscode-input-foreground': 'var(--vscode-input-foreground)',
				'vscode-input-border': 'var(--vscode-input-border)',
				'vscode-editor-background': 'var(--vscode-editor-background)',
				'vscode-panel-background': 'var(--vscode-panel-background)',
				'vscode-sideBar-background': 'var(--vscode-sideBar-background)',
			},
			fontFamily: {
				sans: ['var(--vscode-font-family)', 'sans-serif'],
			},
		},
	},
	plugins: [],
};

