#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { ThemeProvider } from './components/ThemeProvider.js';

// Main entry point - render directly
console.clear();
render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
