#!/usr/bin/env node
import React from 'react';
import { render, Instance } from 'ink';
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

// Clear the screen and render full screen
console.clear();
inkInstance = render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
