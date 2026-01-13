#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { ThemeProvider } from './components/ThemeProvider.js';

// Clear the screen and render full screen
console.clear();
render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
