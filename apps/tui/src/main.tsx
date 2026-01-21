/**
 * Entry point for Clive TUI
 * Initializes OpenTUI/React renderer and mounts the App component
 */

import { createRoot } from '@opentui/react';
import { createCliRenderer } from '@opentui/core';
import App from './App';

// createCliRenderer is async - must await it
const renderer = await createCliRenderer();
const root = createRoot(renderer);
root.render(<App />);
