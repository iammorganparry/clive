/**
 * Entry point for Clive TUI
 * Initializes OpenTUI/React renderer and mounts the App component
 */

import { createRoot } from '@opentui/react';
import { createCliRenderer } from '@opentui/core';
import App from './App';

const renderer = createCliRenderer();
const root = createRoot(renderer);
root.render(<App />);
