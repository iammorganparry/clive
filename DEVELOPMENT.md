# Development Guide

This document provides detailed technical information for developers working on Clive.

## Architecture Overview

Clive follows a clean architecture pattern with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                    │
│                                                         │
│  ┌──────────────┐         ┌──────────────────────┐    │
│  │  Extension   │◄────────┤   Command Center     │    │
│  │  Entry Point │         │   (Commands)        │    │
│  └──────┬───────┘         └──────────────────────┘    │
│         │                                                │
│         ├─────────────────────────────────────────────┐ │
│         │                                             │ │
│  ┌──────▼──────────┐      ┌──────────────────────┐  │ │
│  │ View Provider   │◄─────┤  Services Layer      │  │ │
│  │ (Webview Mgmt)  │      │  - Detector          │  │ │
│  └──────┬──────────┘      │  - Setup             │  │ │
│         │                  └──────────────────────┘  │ │
│         │                                             │ │
│         └─────────────────────────────────────────────┘ │
│                    Message Passing                      │
└─────────────────────────────────────────────────────────┘
                          │
                          │ postMessage
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    React Webview                        │
│                                                         │
│  ┌──────────────┐         ┌──────────────────────┐    │
│  │   App.tsx    │◄────────┤  React Query         │    │
│  │  (Root)      │         │  (State Management)  │    │
│  └──────┬───────┘         └──────────────────────┘    │
│         │                                                │
│         ├─────────────────────────────────────────────┐ │
│         │                                             │ │
│  ┌──────▼──────────┐      ┌──────────────────────┐  │ │
│  │  Components     │      │  Message Handler     │  │ │
│  │  - Status       │      │  (VSCode API)        │  │ │
│  │  - Welcome      │      └──────────────────────┘  │ │
│  └─────────────────┘                                  │ │
└─────────────────────────────────────────────────────────┘
```

## File Structure Details

### Extension Side (`src/`)

#### `extension.ts`
- Entry point for the VS Code extension
- Activates when extension loads
- Registers view provider and command center
- Uses Effect-TS for functional side effects

#### `commands/command-center.ts`
- Centralized command registration
- All VS Code commands defined here
- Manages command lifecycle and disposal
- Uses constants from `constants.ts`

#### `services/playwright-detector.ts`
- Recursively scans workspace for Playwright
- Uses `vscode.workspace.findFiles()` to find all `package.json` files
- Checks each package for:
  - `@playwright/test` in dependencies/devDependencies
  - `playwright.config.{ts,js,mjs}` files
- Returns aggregated status with package-level details

#### `services/playwright-setup.ts`
- Executes Playwright initialization
- Detects package manager from lock files
- Creates VS Code terminal to run commands
- Supports npm, yarn, and pnpm

#### `views/clive-view-provider.ts`
- Implements `vscode.WebviewViewProvider`
- Manages webview lifecycle
- Handles message passing between extension and webview
- Watches file system for changes
- Updates webview when status changes

#### `constants.ts`
- Centralized constants for:
  - Command IDs
  - View IDs
  - Webview message commands
- Prevents magic strings throughout codebase

### Webview Side (`src/webview/`)

#### `index.tsx`
- Entry point for React webview
- Sets up React Query client
- Renders App component
- Acquires VS Code API

#### `App.tsx`
- Main React component
- Uses React Query for data fetching:
  - `useQuery` for Playwright status
  - `useMutation` for setup actions
- Handles message events from extension
- Updates query cache when messages arrive
- Uses `useCallback` for event handlers

#### `components/PlaywrightStatus.tsx`
- Displays Playwright installation status
- Shows package list for monorepos
- Provides setup buttons per package
- Handles loading and error states

#### `components/Welcome.tsx`
- Welcome screen shown when no status available
- Simple placeholder component

## Message Flow

### Extension → Webview

1. Extension detects status change (file watcher or manual check)
2. Calls `checkPlaywrightStatus()`
3. Sends message via `webview.postMessage()`:
   ```typescript
   {
     command: WebviewMessages.playwrightStatus,
     status: PlaywrightStatusData
   }
   ```
4. Webview receives message in `handleMessage`
5. Updates React Query cache with `queryClient.setQueryData()`

### Webview → Extension

1. User clicks "Setup Playwright"
2. Webview sends message:
   ```typescript
   {
     command: WebviewMessages.setupPlaywright,
     targetDirectory?: string
   }
   ```
3. Extension receives in `onDidReceiveMessage`
4. Calls `handleSetupPlaywright()`
5. Executes setup via `setupPlaywright()`
6. Sends progress updates back to webview

## React Query Integration

Clive uses React Query for all async operations:

### Status Query
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['playwright-status'],
  queryFn: async () => {
    // Creates promise that resolves when message arrives
    const message = await createMessagePromise(
      vscode,
      WebviewMessages.refreshStatus,
      WebviewMessages.playwrightStatus
    );
    return message.status;
  }
});
```

### Setup Mutation
```typescript
const setupMutation = useMutation({
  mutationFn: async (targetDirectory?: string) => {
    // Promise-based message handling
    return new Promise((resolve, reject) => {
      // Listens for setup-start or setup-error messages
    });
  },
  onSuccess: () => {
    // Invalidates status query to refetch
    queryClient.invalidateQueries({ queryKey: ['playwright-status'] });
  }
});
```

## Effect-TS Usage

The extension uses Effect-TS for functional programming:

```typescript
pipe(
  Effect.sync(() => {
    // Synchronous operation
    return value;
  }),
  Effect.flatMap((value) => {
    // Transform value
    return Effect.promise(async () => {
      // Async operation
    });
  }),
  Effect.runPromise
);
```

Benefits:
- Composable operations
- Type-safe error handling
- Clear separation of sync/async
- Testable code

## Building Process

### Extension Build (esbuild)

Configuration in `esbuild.js`:
- Entry: `src/extension.ts`
- Output: `dist/extension.js`
- Format: CommonJS
- Platform: Node.js
- External: `vscode` (provided by VS Code)

### Webview Build (Vite)

Configuration in `vite.config.ts`:
- Entry: `src/webview/index.tsx`
- Output: `dist/webview/`
- Framework: React
- CSS: Tailwind CSS via PostCSS

### Watch Mode

Runs three processes in parallel:
1. `watch:esbuild` - Extension code changes
2. `watch:vite` - Webview code changes
3. `watch:tsc` - Type checking

## Testing Workflow

### 1. Start Development

```bash
# Terminal 1: Watch mode
yarn watch

# Terminal 2: Launch extension (F5 in VS Code)
```

### 2. Make Changes

- **Extension code**: Edit files in `src/` (except `webview/`)
  - Changes rebuild automatically
  - Reload Extension Development Host window
  - Or use Command Palette: "Developer: Reload Window"

- **Webview code**: Edit files in `src/webview/`
  - Changes rebuild automatically
  - Refresh webview (close and reopen sidebar)
  - Or use Developer Tools to see changes

### 3. Debug

- **Extension**: Set breakpoints, use VS Code debugger
- **Webview**: Open Developer Tools, use browser debugger
- **Logs**: Check Output panel → "Clive" channel

## Common Development Tasks

### Adding a New Command

1. Add constant to `src/constants.ts`:
   ```typescript
   export const Commands = {
     // ... existing
     myNewCommand: 'clive.myNewCommand',
   } as const;
   ```

2. Register in `src/commands/command-center.ts`:
   ```typescript
   private registerMyNewCommand(): void {
     const disposable = vscode.commands.registerCommand(
       Commands.myNewCommand,
       () => {
         // Implementation
       }
     );
     this.disposables.push(disposable);
   }
   ```

3. Call in `registerAll()`:
   ```typescript
   registerAll(context: vscode.ExtensionContext): void {
     // ... existing
     this.registerMyNewCommand();
   }
   ```

4. Add to `package.json`:
   ```json
   {
     "command": "clive.myNewCommand",
     "title": "My New Command"
   }
   ```

### Adding a New Webview Message

1. Add constant to `src/constants.ts`:
   ```typescript
   export const WebviewMessages = {
     // ... existing
     myNewMessage: 'my-new-message',
   } as const;
   ```

2. Handle in `src/views/clive-view-provider.ts`:
   ```typescript
   case WebviewMessages.myNewMessage:
     this.handleMyNewMessage(message.data);
     break;
   ```

3. Send from webview in `src/webview/App.tsx`:
   ```typescript
   vscode.postMessage({
     command: WebviewMessages.myNewMessage,
     data: myData
   });
   ```

### Adding a New Service

1. Create file in `src/services/`:
   ```typescript
   export async function myService(options: MyOptions): Promise<MyResult> {
     // Implementation using Effect-TS
     return pipe(
       Effect.sync(() => { /* ... */ }),
       Effect.runPromise
     );
   }
   ```

2. Import and use where needed

## Type Safety

All code is fully typed:
- TypeScript strict mode enabled
- No `any` types
- Interfaces for all data structures
- Type-safe message passing

## Error Handling

- **Extension**: Uses Effect-TS error handling
- **Webview**: React Query error states
- **Messages**: Promise rejection for errors
- **User Feedback**: VS Code notifications

## Performance Considerations

- **File Watching**: Uses VS Code's efficient file watchers
- **Query Caching**: React Query caches status
- **Lazy Loading**: Commands loaded on demand
- **Bundle Size**: Tree-shaking enabled in builds

## Debugging Tips

1. **Extension not loading**: Check `dist/extension.js` exists
2. **Webview blank**: Check browser console in Developer Tools
3. **Messages not working**: Verify message command constants match
4. **Status not updating**: Check file watchers are active
5. **Build errors**: Run `yarn check-types` to see TypeScript errors

## Code Style

- **Indentation**: Tabs (configured in Biome)
- **Quotes**: Double quotes (configured in Biome)
- **Semicolons**: Yes
- **Line Length**: 100 characters
- **Imports**: Organized by type (external, internal)

## Dependencies

### Runtime Dependencies
- `effect` - Functional programming
- `react` / `react-dom` - UI framework
- `@tanstack/react-query` - State management
- `@vscode/webview-ui-toolkit` - VS Code UI components

### Dev Dependencies
- `typescript` - Type checking
- `esbuild` - Extension bundler
- `vite` - Webview bundler
- `eslint` - Linting
- `@biomejs/biome` - Formatting

## Troubleshooting

### Extension Host Crashes
- Check for infinite loops
- Verify all promises resolve/reject
- Check for memory leaks

### Webview Not Rendering
- Verify React Query provider is set up
- Check for JavaScript errors in console
- Verify webview assets are loading

### Build Failures
- Clear `dist/` folder
- Delete `node_modules` and reinstall
- Check TypeScript version compatibility

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Effect-TS Documentation](https://effect.website/)
- [React Query Documentation](https://tanstack.com/query/latest)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

