#!/usr/bin/env node
import React from 'react';
import { render, Instance } from 'ink';
import { spawnSync } from 'node:child_process';
import { App } from './App.js';
import { ThemeProvider } from './components/ThemeProvider.js';

// Store the render instance for suspend/resume
let inkInstance: Instance | null = null;

export function suspendTUI(): void {
  if (inkInstance) {
    inkInstance.unmount();
    inkInstance = null;
    // Clear screen when suspending
    console.clear();
  }
}

export function resumeTUI(): void {
  if (!inkInstance) {
    console.clear();
    inkInstance = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
  }
}

// Check if we're in tmux
function isInTmux(): boolean {
  return !!process.env.TMUX;
}

// Check if tmux is available
function hasTmux(): boolean {
  const result = spawnSync('which', ['tmux'], { encoding: 'utf8' });
  return result.status === 0;
}

// Start tmux with clive
function startInTmux(): void {
  const clivePath = process.argv[1]; // Path to this script
  const args = process.argv.slice(2).join(' ');
  const cwd = process.cwd(); // Preserve current working directory

  // Create a new tmux session named 'clive' running this script
  // -c flag sets the working directory for the new session
  const result = spawnSync('tmux', [
    'new-session',
    '-s', 'clive',
    '-n', 'CLIVE',
    '-c', cwd,  // Start in current directory
    `node ${clivePath} ${args}`,
  ], {
    stdio: 'inherit',
    env: { ...process.env },
    cwd: cwd,
  });

  process.exit(result.status ?? 0);
}

// Main entry point
if (!isInTmux() && hasTmux()) {
  // Not in tmux but tmux is available - start a tmux session
  startInTmux();
} else {
  // Already in tmux or tmux not available - render directly
  console.clear();
  inkInstance = render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}
