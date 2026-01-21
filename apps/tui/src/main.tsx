/**
 * Entry point for Clive TUI
 * Initializes OpenTUI/React renderer and mounts the App component
 */

import { createRoot } from '@opentui/react';
import { createCliRenderer } from '@opentui/core';
import App from './App';
import { getLogFilePath, debugLog } from './utils/debug-logger';

// Parse command line arguments
const args = process.argv.slice(2);
const hasDebugFlag = args.includes('--debug') || args.includes('-d');

// Enable debug mode if --debug flag is present
if (hasDebugFlag) {
  process.env.DEBUG = 'true';
  process.env.NODE_ENV = 'development';
}

// Log startup
debugLog('main', 'Clive TUI starting up', {
  args: args,
  debugEnabled: hasDebugFlag || !!process.env.DEBUG || process.env.NODE_ENV === 'development'
});

if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
  console.log(`\nDebug logging enabled. Log file: ${getLogFilePath()}\n`);
  console.log('Tail logs in another terminal: tail -f ~/.clive/tui-debug.log\n');
}

// createCliRenderer is async - must await it
// Set fullscreen: true to remove margins
const renderer = await createCliRenderer({ fullscreen: true });
const root = createRoot(renderer);
root.render(<App />);
