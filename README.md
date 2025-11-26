# Clive - AI-Powered Playwright Test Generator

Clive is a VS Code extension that helps developers set up and manage Playwright for end-to-end testing. It provides automatic detection of Playwright installation status across monorepos and one-click setup functionality.

## Features

### 🎯 Playwright Detection & Setup
- **Automatic Detection**: Recursively scans your workspace to detect Playwright installation across all packages
- **Monorepo Support**: Full support for monorepos with multiple `package.json` files
- **One-Click Setup**: Set up Playwright in any package with a single click
- **Real-Time Status**: Automatically refreshes status when files change
- **Package Manager Detection**: Automatically detects npm, yarn, or pnpm

### 📊 Visual Status Dashboard
- **Sidebar View**: Beautiful React-based sidebar showing Playwright status
- **Package-Level Status**: See which packages have Playwright installed and configured
- **Visual Indicators**: Clear icons and colors showing installation status
- **Individual Package Actions**: Setup buttons for each package in monorepos

## Architecture

Clive is built with a modern architecture using:

- **TypeScript** - Type-safe codebase
- **React** - Modern UI components for the webview
- **Effect-TS** - Functional programming for side effects
- **React Query** - State management and data fetching
- **Tailwind CSS** - Utility-first styling
- **VS Code Extension API** - Native VS Code integration

## Project Structure

```
clive/
├── src/
│   ├── commands/
│   │   └── command-center.ts      # Centralized command registration
│   ├── constants.ts                # All magic strings as constants
│   ├── extension.ts                # Extension entry point
│   ├── services/
│   │   ├── playwright-detector.ts   # Playwright detection logic
│   │   └── playwright-setup.ts     # Playwright setup execution
│   ├── views/
│   │   └── clive-view-provider.ts  # Webview provider
│   └── webview/
│       ├── App.tsx                 # Main React app
│       ├── components/
│       │   ├── PlaywrightStatus.tsx # Status display component
│       │   └── Welcome.tsx          # Welcome screen
│       ├── index.tsx                # Webview entry point
│       └── index.css                # Styles
├── dist/                            # Compiled output
├── package.json                     # Extension manifest
└── README.md                        # This file
```

## Key Components

### Command Center (`src/commands/command-center.ts`)
Centralized command registration system. All VS Code commands are registered here:
- `clive.showView` - Shows/reveals the Clive sidebar
- `clive.helloWorld` - Example command
- `clive.setupPlaywright` - Sets up Playwright in a directory

### Playwright Detector (`src/services/playwright-detector.ts`)
Recursively scans the workspace to detect Playwright installation:
- Finds all `package.json` files (excluding `node_modules`)
- Checks for `@playwright/test` dependency
- Checks for `playwright.config.{ts,js,mjs}` files
- Returns aggregated status across all packages

### Playwright Setup (`src/services/playwright-setup.ts`)
Handles Playwright initialization:
- Detects package manager (npm/yarn/pnpm)
- Executes `npm init playwright@latest` (or equivalent)
- Runs in VS Code terminal for visibility
- Supports monorepo setups

### View Provider (`src/views/clive-view-provider.ts`)
Manages the webview lifecycle:
- Creates and manages the React webview
- Handles messages between extension and webview
- Watches for file changes to auto-refresh status
- Sends Playwright status updates to webview

### Webview App (`src/webview/App.tsx`)
React application using React Query:
- Uses `useQuery` for Playwright status
- Uses `useMutation` for setup actions
- Handles message-based communication
- Displays status or welcome screen

## Quick Start

### Prerequisites
- Node.js (v18 or higher)
- Yarn (or npm)
- VS Code or Cursor
- TypeScript

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd clive
```

2. Install dependencies:
```bash
yarn install
```

3. Build the extension:
```bash
yarn compile
```

4. Launch in Cursor/VS Code:
   - Press `F5` to open Extension Development Host
   - Or see [Testing Guide](docs/TESTING.md) for detailed instructions

## Documentation

- **[Development Guide](docs/DEVELOPMENT.md)** - Detailed technical documentation, architecture, and development workflows
- **[Testing Guide](docs/TESTING.md)** - Comprehensive testing instructions and scenarios
- **[README](README.md)** - This file - Overview and quick reference

## Building

```bash
# Development build with watch mode
yarn watch

# Production build
yarn package

# Type checking
yarn check-types

# Linting
yarn lint
```

See [Development Guide](docs/DEVELOPMENT.md) for detailed build instructions.

## Commands

All commands are registered in `CommandCenter`:

| Command | ID | Description |
|---------|-----|-------------|
| Show Clive | `clive.showView` | Opens/focuses the Clive sidebar |
| Hello World | `clive.helloWorld` | Example command |
| Setup Playwright | `clive.setupPlaywright` | Sets up Playwright in target directory |

## Constants

All magic strings are centralized in `src/constants.ts`:

- **Commands**: Command IDs (`Commands.showView`, etc.)
- **Views**: View IDs (`Views.mainView`, etc.)
- **WebviewMessages**: Message commands for webview communication

## Scripts Reference

```bash
# Development
yarn watch              # Watch mode for all files
yarn watch:esbuild      # Watch extension code only
yarn watch:vite         # Watch webview code only
yarn watch:tsc          # Type check in watch mode

# Building
yarn compile            # Full compile (type check + lint + build)
yarn build:extension    # Build extension only
yarn build:webview      # Build webview only
yarn package            # Production build

# Quality
yarn check-types        # TypeScript type checking
yarn lint               # ESLint linting
yarn test               # Run tests
```

## Next Steps

Future enhancements planned:
- [ ] AI-powered test generation
- [ ] Test file creation from UI
- [ ] Integration with test runners
- [ ] Test execution and results display
- [ ] Code snippets and templates

## Contributing

1. Read the [Development Guide](docs/DEVELOPMENT.md) to understand the codebase
2. Follow the [Testing Guide](docs/TESTING.md) to ensure your changes work correctly
3. Read the [Contributing Guide](docs/CONTRIBUTING.md) for commit message format
4. Fork the repository
5. Create a feature branch
6. Make your changes
7. Run `yarn compile` to ensure everything builds
8. Commit with semantic commit messages (enforced by commitlint)
9. Submit a pull request

### Commit Message Format

Clive uses [Conventional Commits](https://www.conventionalcommits.org/). All commits must follow the format:

```
<type>(<scope>): <subject>
```

Examples:
- `feat(webview): add Playwright status component`
- `fix(services): handle missing workspace gracefully`
- `docs(docs): add testing guide`

See [Contributing Guide](docs/CONTRIBUTING.md) for full details.

For detailed information about code style, architecture, and development workflows, see the [Development Guide](docs/DEVELOPMENT.md).

## License

See [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions, please open an issue on GitHub.

## Documentation

- **[Development Guide](docs/DEVELOPMENT.md)** - Complete technical documentation
- **[Testing Guide](docs/TESTING.md)** - Testing instructions and scenarios
- **[Documentation Index](docs/README.md)** - Overview of all documentation
