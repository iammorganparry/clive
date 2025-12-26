# Clive - AI Test Writer

> Your AI-powered test writer for automated testing across all languages and frameworks

Clive is a VS Code and Cursor extension that helps you generate and manage automated tests using AI. It analyzes your codebase, detects changed files, and generates comprehensive test suites tailored to your project.

## Features

- 🤖 **AI-Powered Test Generation** - Generate tests automatically using advanced AI models
- 🔍 **Smart File Detection** - Automatically detects changed files across your repository
- 🌐 **Multi-Language Support** - Works with TypeScript, JavaScript, Python, Java, Go, Rust, Ruby, PHP, C#, C/C++, Swift, and more
- 🔄 **Branch-Aware** - Tracks changes across git branches and suggests tests for modified files
- 📊 **Dashboard View** - Beautiful interface to view branch changes and manage test generation
- ⚡ **Framework Agnostic** - Works with any testing framework or language
- 🎨 **Modern UI** - Clean, intuitive webview interface built with React

## Installation

### From VS Code Marketplace

1. Open VS Code or Cursor
2. Go to Extensions (Cmd+Shift+X / Ctrl+Shift+X)
3. Search for "Clive"
4. Click Install

### Manual Installation

1. Download the `.vsix` file from the releases page
2. Open VS Code/Cursor
3. Go to Extensions
4. Click the `...` menu and select "Install from VSIX..."
5. Select the downloaded `.vsix` file

### Development Installation

```bash
# Install dependencies
yarn install

# Build the extension
yarn compile

# Install in VS Code
yarn install:local

# Install in Cursor
yarn install:cursor
```

## Usage

### Getting Started

1. Open a project in VS Code or Cursor
2. Click the Clive icon in the Activity Bar (beaker icon)
3. The extension will automatically detect changed files in your current branch
4. Review the list of eligible files
5. Click "Generate Tests" to create test files

### Branch Changes View

The extension shows:
- Current branch name
- Files changed compared to the base branch
- Eligibility status for each file
- Quick actions to generate tests

### Generating Tests

1. Select files you want to test from the branch changes view
2. Click "Generate Tests for All Changes" or generate tests for individual files
3. Review the generated test code
4. Accept or modify the tests as needed

## Requirements

- VS Code or Cursor version 1.105.0 or higher
- Node.js (for development)

## Extension Settings

This extension contributes the following settings:

- `clive.apiKey`: Your API key for AI test generation (optional, can be configured in extension)

## Commands

- `Clive: Show View` - Opens the Clive dashboard view
- `Clive: Hello World` - Example command

## Known Issues

None at this time. Please report issues on GitHub.

## Release Notes

### 0.0.1

Initial release of Clive:
- Branch changes detection
- Multi-language file filtering
- AI-powered test generation
- Modern dashboard interface

## Contributing

Contributions are welcome! Please see our [Contributing Guide](https://github.com/iammorganparry/clive/blob/main/docs/CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](https://github.com/iammorganparry/clive/blob/main/apps/extension/LICENSE) file for details.

## Support

- [GitHub Issues](https://github.com/iammorganparry/clive/issues)
- [Documentation](https://github.com/iammorganparry/clive/blob/main/docs/README.md)

