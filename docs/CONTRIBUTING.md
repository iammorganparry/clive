# Contributing to Clive

Thank you for your interest in contributing to Clive! This document provides guidelines for contributing.

## Commit Message Format

Clive uses [Conventional Commits](https://www.conventionalcommits.org/) to maintain a clear commit history. All commit messages must follow this format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Type

The type must be one of the following:

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, etc.)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing tests or correcting existing tests
- **build**: Changes that affect the build system or external dependencies
- **ci**: Changes to CI configuration files and scripts
- **chore**: Other changes that don't modify src or test files
- **revert**: Reverts a previous commit

### Scope

The scope should be one of the following (optional but recommended):

- **extension**: Extension code (`src/extension.ts`)
- **webview**: Webview/React code (`src/webview/`)
- **services**: Service layer (`src/services/`)
- **commands**: Commands (`src/commands/`)
- **views**: View providers (`src/views/`)
- **docs**: Documentation (`docs/`, `README.md`)
- **config**: Configuration files (`.vscode/`, `vite.config.ts`, etc.)
- **build**: Build system (`esbuild.js`, build scripts)
- **deps**: Dependencies (`package.json`)

### Subject

- Use imperative, present tense: "change" not "changed" nor "changes"
- Don't capitalize the first letter
- No period (.) at the end
- Keep it concise but descriptive

### Examples

```
feat(webview): add Playwright status component
fix(services): handle missing workspace gracefully
docs(docs): add testing guide
refactor(commands): extract CommandCenter class
style(extension): format code with Biome
test(services): add tests for playwright-detector
build(config): update Vite config to flatten output
chore(deps): update dependencies
```

### Invalid Examples

```
❌ Added new feature
❌ fix bug
❌ docs: update readme
❌ feat: add feature (missing scope)
❌ feat(webview): Add new component (capitalized)
❌ feat(webview): add new component. (period at end)
```

## Pre-commit Hooks

Husky runs commitlint automatically when you commit. If your commit message doesn't follow the format, the commit will be rejected with an error message explaining what's wrong.

## Getting Help

If you're unsure about the commit format, you can:

1. Check existing commits: `git log --oneline`
2. Run commitlint manually: `yarn commitlint`
3. See the commitlint output for detailed error messages

## Workflow

1. Make your changes
2. Stage your changes: `git add .`
3. Commit with a semantic message: `git commit -m "feat(webview): add new feature"`
4. Push your changes

The commit hook will automatically validate your commit message format.

