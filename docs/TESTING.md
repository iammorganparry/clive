# Testing Guide

Quick reference for testing Clive extension in Cursor/VS Code.

## Quick Start

1. **Build the extension**
   ```bash
   yarn watch
   ```

2. **Launch in Cursor/VS Code**
   - Press `F5`
   - New Extension Development Host window opens

3. **Open Clive sidebar**
   - Click beaker icon in Activity Bar
   - Or use Command Palette: "Show Clive"

## Testing Checklist

### ✅ Basic Functionality

- [ ] Extension loads without errors
- [ ] Clive sidebar appears in Activity Bar
- [ ] Sidebar opens and displays content
- [ ] No console errors in Extension Host window

### ✅ Playwright Detection

- [ ] **No Playwright**: Shows "not installed" status
- [ ] **Has Playwright**: Shows "installed" status
- [ ] **Partial**: Shows "partial" status with package list
- [ ] Status updates when files change

### ✅ Monorepo Support

- [ ] Detects multiple packages
- [ ] Shows status for each package
- [ ] Individual setup buttons per package
- [ ] Root package detected correctly

### ✅ Setup Functionality

- [ ] "Setup Playwright" button appears when not installed
- [ ] Clicking button opens terminal
- [ ] Terminal runs correct command (npm/yarn/pnpm)
- [ ] Status updates after setup completes
- [ ] Error handling works if setup fails

### ✅ Package Manager Detection

- [ ] Detects npm (package-lock.json)
- [ ] Detects yarn (yarn.lock)
- [ ] Detects pnpm (pnpm-lock.yaml)
- [ ] Uses correct init command for each

## Test Scenarios

### Scenario 1: Fresh Project

1. Create new folder
2. Create `package.json`:
   ```json
   {
     "name": "test-project",
     "version": "1.0.0"
   }
   ```
3. Open folder in Extension Development Host
4. Open Clive sidebar
5. **Expected**: Shows "Playwright is not installed"
6. Click "Setup Playwright"
7. **Expected**: Terminal opens, runs `npm init playwright@latest -- --yes`
8. Wait for completion
9. **Expected**: Status updates to show Playwright installed

### Scenario 2: Existing Playwright Project

1. Create project with Playwright already installed
2. Open in Extension Development Host
3. Open Clive sidebar
4. **Expected**: Shows "✓ Configured" or "Playwright is installed"

### Scenario 3: Monorepo

1. Create monorepo structure:
   ```
   monorepo/
   ├── package.json
   ├── packages/
   │   ├── app/
   │   │   └── package.json
   │   └── lib/
   │       └── package.json
   ```
2. Add workspaces to root `package.json`:
   ```json
   {
     "workspaces": ["packages/*"]
   }
   ```
3. Open root folder in Extension Development Host
4. Open Clive sidebar
5. **Expected**: Shows list of all packages
6. **Expected**: Each package shows its status
7. Click "Setup Playwright" on a package
8. **Expected**: Sets up Playwright in that package only

### Scenario 4: File Changes

1. Open project with Playwright installed
2. Open Clive sidebar
3. Delete `playwright.config.ts`
4. **Expected**: Status updates automatically
5. Restore file
6. **Expected**: Status updates back

## Debugging Steps

### Extension Not Loading

1. Check `dist/extension.js` exists
2. Check Output panel → "Clive" channel
3. Check Debug Console for errors
4. Verify build completed successfully

### Webview Not Showing

1. Open Developer Tools (right-click webview → Inspect)
2. Check Console for errors
3. Verify `dist/webview/webview.js` exists
4. Check Network tab for failed asset loads

### Status Not Updating

1. Check file watchers are active
2. Verify workspace folder is open
3. Check extension logs in Output panel
4. Try manual refresh (close/reopen sidebar)

### Setup Not Working

1. Check terminal opens
2. Verify command runs
3. Check for package manager detection
4. Verify target directory is correct
5. Check terminal output for errors

## Browser Developer Tools

### Opening Developer Tools

**Method 1**: Right-click in webview
- Right-click anywhere in the Clive sidebar
- Select "Inspect" or "Inspect Element"

**Method 2**: Command Palette
- `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
- Type: "Developer: Open Webview Developer Tools"
- Select the Clive webview

### Useful Console Commands

```javascript
// Check React Query cache
window.__REACT_QUERY_STATE__

// Check VS Code API
window.acquireVsCodeApi()

// Send test message
vscode.postMessage({ command: 'refresh-status' })
```

## Extension Host Logs

### Viewing Logs

1. Open Output panel (`Cmd+Shift+U`)
2. Select "Clive" from dropdown
3. See all console.log output from extension

### Common Log Messages

- `"Clive webview is ready"` - Webview initialized
- `"Clive view became visible"` - Sidebar opened
- `"Error checking package..."` - Package detection error

## Performance Testing

### Large Monorepo

1. Test with 50+ packages
2. Verify detection completes in reasonable time
3. Check UI remains responsive
4. Verify file watchers don't cause performance issues

### Many File Changes

1. Make rapid file changes
2. Verify status updates don't lag
3. Check for memory leaks
4. Verify no duplicate updates

## Edge Cases

### Empty Workspace
- [ ] Handles gracefully
- [ ] Shows appropriate message

### No package.json
- [ ] Handles gracefully
- [ ] Shows "not installed"

### Corrupted package.json
- [ ] Handles JSON parse errors
- [ ] Continues checking other packages

### Nested node_modules
- [ ] Excludes from detection
- [ ] Doesn't slow down scanning

### Symlinks
- [ ] Handles correctly
- [ ] Doesn't duplicate packages

## Automated Testing

Run tests:
```bash
yarn test
```

Test files:
- `src/test/extension.test.ts`

## Manual Test Script

Quick test script:

```bash
#!/bin/bash
# Quick test script

echo "Building extension..."
yarn compile

echo "Checking for build output..."
if [ ! -f "dist/extension.js" ]; then
    echo "❌ Extension build failed"
    exit 1
fi

if [ ! -f "dist/webview/webview.js" ]; then
    echo "❌ Webview build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""
echo "Next steps:"
echo "1. Press F5 to launch Extension Development Host"
echo "2. Open Clive sidebar"
echo "3. Test Playwright detection and setup"
```

## Reporting Issues

When reporting issues, include:

1. **Environment**
   - Cursor/VS Code version
   - Node.js version
   - OS version

2. **Steps to Reproduce**
   - Detailed steps
   - Expected vs actual behavior

3. **Logs**
   - Extension Host logs
   - Browser console logs
   - Screenshots if applicable

4. **Project Structure**
   - Single package or monorepo
   - Package manager used
   - Existing Playwright installation

