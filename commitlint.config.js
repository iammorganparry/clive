module.exports = {
	extends: ['@commitlint/config-conventional'],
	rules: {
		'type-enum': [
			2,
			'always',
			[
				'feat', // New feature
				'fix', // Bug fix
				'docs', // Documentation changes
				'style', // Code style changes (formatting, etc.)
				'refactor', // Code refactoring
				'perf', // Performance improvements
				'test', // Adding or updating tests
				'build', // Build system or dependencies
				'ci', // CI/CD changes
				'chore', // Other changes that don't modify src or test files
				'revert', // Revert a previous commit
			],
		],
		'scope-enum': [
			2,
			'always',
			[
				'extension', // Extension code
				'webview', // Webview/React code
				'services', // Service layer
				'commands', // Commands
				'views', // View providers
				'docs', // Documentation
				'config', // Configuration files
				'build', // Build system
				'deps', // Dependencies
			],
		],
		'scope-empty': [1, 'never'], // Warn if scope is empty
		'subject-empty': [2, 'never'], // Subject is required
		'subject-full-stop': [2, 'never', '.'], // No period at end
		'header-max-length': [2, 'always', 100], // Max header length
		'type-case': [2, 'always', 'lower-case'],
		'scope-case': [2, 'always', 'lower-case'],
		'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
	},
};

