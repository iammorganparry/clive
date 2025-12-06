# Welcome to your VS Code Extension

## What's in the folder

* This folder contains all of the files necessary for your extension.
* `package.json` - this is the manifest file in which you declare your extension and command.
  * The sample plugin registers a command and defines its title and command name. With this information VS Code can show the command in the command palette. It doesn't yet need to load the plugin.
* `src/extension.ts` - this is the main file where you will provide the implementation of your command.
  * The file exports one function, `activate`, which is called the very first time your extension is activated (in this case by executing the command). Inside the `activate` function we call `registerCommand`.
  * We pass the function containing the implementation of the command as the second parameter to `registerCommand`.

## Monorepo Setup

This extension is part of a monorepo. The VS Code configuration files are located in the root `.vscode/` directory.

### Prerequisites

1. Ensure all dependencies are installed from the repository root:
   ```bash
   yarn install
   ```

2. Build the UI package (required dependency):
   ```bash
   yarn workspace @clive/ui build
   ```

## Get up and running straight away

1. **Build the extension** (from repository root):
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Run "Tasks: Run Build Task" (or press `Ctrl+Shift+B` / `Cmd+Shift+B`)
   - This will build `@clive/ui` and then compile the extension

2. **Launch the extension**:
   - Press `F5` to open a new window with your extension loaded
   - Or use the Run and Debug view (Ctrl+Shift+D / Cmd+Shift+D) and select "Run Extension"

3. **Test the extension**:
   - Run your command from the command palette by pressing (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and typing `Show Clive`
   - Set breakpoints in your code inside `src/extension.ts` to debug your extension
   - Find output from your extension in the debug console

## Make changes

* **Extension code** (`src/extension.ts`, `src/views/`, etc.):
  - Changes rebuild automatically if watch mode is running
  - Reload the Extension Development Host window (`Ctrl+R` or `Cmd+R` on Mac)
  - Or use Command Palette: "Developer: Reload Window"

* **Webview code** (`src/webview/`):
  - Changes rebuild automatically if watch mode is running
  - Refresh webview by closing and reopening the sidebar view
  - Or use Developer Tools (Help > Toggle Developer Tools) to see changes

## Watch Mode (Development)

For active development, run watch mode from the repository root:

```bash
# Terminal 1: Watch extension and webview
yarn workspace clive watch

# Or use VS Code tasks:
# Press Ctrl+Shift+P > "Tasks: Run Task" > "watch:all"
```

This will:
- Watch and rebuild extension code (`watch:esbuild`)
- Watch and rebuild webview code (`watch:vite`)
- Watch TypeScript types (`watch:tsc`)


## Explore the API

* You can open the full set of our API when you open the file `node_modules/@types/vscode/index.d.ts`.

## Run tests

* Install the [Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
* Run the "watch" task via the **Tasks: Run Task** command. Make sure this is running, or tests might not be discovered.
* Open the Testing view from the activity bar and click the Run Test" button, or use the hotkey `Ctrl/Cmd + ; A`
* See the output of the test result in the Test Results view.
* Make changes to `src/test/extension.test.ts` or create new test files inside the `test` folder.
  * The provided test runner will only consider files matching the name pattern `**.test.ts`.
  * You can create folders inside the `test` folder to structure your tests any way you want.

## Go further

* Reduce the extension size and improve the startup time by [bundling your extension](https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
* [Publish your extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) on the VS Code extension marketplace.
* Automate builds by setting up [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration).
