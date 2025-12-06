# Testing the Extension in VS Code

This guide explains how to test and debug the Clive extension in VS Code within the monorepo setup.

## Prerequisites

1. **Install dependencies** (from repository root):
   ```bash
   yarn install
   ```

2. **Build UI package** (required dependency):
   ```bash
   yarn workspace @clive/ui build
   ```

## Quick Start

### Option 1: Using VS Code Debugger (Recommended)

1. **Open the repository root** in VS Code (not just the `apps/extension` folder)

2. **Build the extension**:
   - Press `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac) to run the default build task
   - Or use Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → "Tasks: Run Build Task" → "build:all"
   - This will automatically build `@clive/ui` first, then compile the extension

3. **Launch the extension**:
   - Press `F5` to start debugging
   - Or go to Run and Debug view (`Ctrl+Shift+D` / `Cmd+Shift+D`) and click "Run Extension"
   - A new VS Code window will open with your extension loaded

4. **Test the extension**:
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - Type "Show Clive" and run the command
   - The Clive sidebar should appear

### Option 2: Using Command Line

1. **Build everything**:
   ```bash
   # From repository root
   yarn workspace @clive/ui build
   yarn workspace clive compile
   ```

2. **Package the extension** (optional, for manual installation):
   ```bash
   yarn workspace clive package
   ```

## Development Workflow

### Watch Mode (Auto-rebuild)

For active development, use watch mode to automatically rebuild on changes:

1. **Start watch mode**:
   - Press `Ctrl+Shift+P` → "Tasks: Run Task" → "watch:all"
   - Or from terminal: `yarn workspace clive watch`

2. **Make changes**:
   - **Extension code** (`src/extension.ts`, `src/views/`, etc.):
     - Changes rebuild automatically
     - Reload Extension Development Host window (`Ctrl+R` / `Cmd+R`)
     - Or use Command Palette: "Developer: Reload Window"
   
   - **Webview code** (`src/webview/`):
     - Changes rebuild automatically
     - Refresh webview by closing and reopening the sidebar
     - Or use Developer Tools (Help > Toggle Developer Tools)

### Debugging

1. **Set breakpoints** in your code:
   - Click in the gutter next to line numbers in `src/extension.ts` or other source files
   - Breakpoints will be hit when code executes

2. **Debug console**:
   - View output and logs in the Debug Console panel
   - Use `Console.log()` statements in your code

3. **Webview debugging**:
   - Right-click in the webview → "Inspect"
   - Or use Help > Toggle Developer Tools in the Extension Development Host window

## VS Code Tasks

Available tasks (run via `Ctrl+Shift+P` → "Tasks: Run Task"):

- **build:all** (default) - Builds UI package and compiles extension
- **build:ui** - Builds only the `@clive/ui` package
- **build:extension** - Builds only the extension code (requires UI built first)
- **build:webview** - Builds only the webview (requires UI built first)
- **watch:all** - Watches extension and webview for changes
- **watch:extension** - Watches only extension code
- **watch:webview** - Watches only webview code
- **watch** - Runs the extension's watch script (includes TypeScript checking)

## Troubleshooting

### Extension doesn't load

1. **Check build output**:
   - Ensure `dist/extension.js` exists in `apps/extension/dist/`
   - Ensure `dist/webview/webview.js` exists in `apps/extension/dist/webview/`

2. **Check UI package**:
   - Ensure `packages/ui/dist/` contains built files
   - Rebuild UI: `yarn workspace @clive/ui build`

3. **Check console**:
   - Open Debug Console in VS Code
   - Look for error messages

### Changes not appearing

1. **Reload window**:
   - Use `Ctrl+R` / `Cmd+R` in Extension Development Host
   - Or Command Palette → "Developer: Reload Window"

2. **Check watch mode**:
   - Ensure watch tasks are running
   - Check terminal output for build errors

3. **Webview changes**:
   - Close and reopen the sidebar view
   - Or refresh using Developer Tools

### Build errors

1. **Type errors**:
   ```bash
   yarn workspace clive check-types
   ```

2. **Lint errors**:
   ```bash
   yarn workspace clive lint
   ```

3. **Clean rebuild**:
   ```bash
   # Clean dist folders
   rm -rf apps/extension/dist
   rm -rf packages/ui/dist
   
   # Rebuild
   yarn workspace @clive/ui build
   yarn workspace clive compile
   ```

## Running Tests

1. **Unit tests**:
   ```bash
   yarn workspace clive test:unit
   ```

2. **Extension tests**:
   ```bash
   yarn workspace clive test
   ```

3. **Watch mode tests**:
   ```bash
   yarn workspace clive test:unit:watch
   ```

## File Structure

```
apps/extension/
├── dist/                    # Built extension (generated)
│   ├── extension.js         # Main extension bundle
│   └── webview/             # Built webview assets
│       ├── webview.js
│       └── webview.css
├── src/                     # Source code
│   ├── extension.ts         # Extension entry point
│   ├── views/               # Webview providers
│   ├── webview/             # React webview UI
│   └── ...
└── package.json             # Extension manifest

packages/ui/
└── dist/                    # Built UI components (required)
```

## Additional Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Extension Development Guide](https://code.visualstudio.com/api/get-started/your-first-extension)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)

