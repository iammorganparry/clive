/**
 * useViewMode Hook
 * Manages view mode transitions using XState: Setup -> Selection -> Main <-> Help
 */

import { useEffect } from 'react';
import { setup, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import { ViewMode, IssueTrackerConfig } from '../types/views';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.clive', 'config.json');
const ENV_PATH = path.join(os.homedir(), '.clive', '.env');

/**
 * Load and set environment variables from ~/.clive/.env
 * This allows storing sensitive credentials outside of config files
 */
function loadEnvFile(): void {
  try {
    if (fs.existsSync(ENV_PATH)) {
      const content = fs.readFileSync(ENV_PATH, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim();
            // Remove quotes if present
            const cleanValue = value.replace(/^["']|["']$/g, '');
            process.env[key.trim()] = cleanValue;
          }
        }
      }
    }
  } catch (error) {
    console.error('[useViewMode] Failed to load .env file:', error);
  }
}

/**
 * Load config from ~/.clive/config.json
 */
function loadConfig(): IssueTrackerConfig | null {
  // Load environment variables first
  loadEnvFile();

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('[useViewMode] Failed to load config:', error);
  }
  return null;
}

/**
 * Save API key to ~/.clive/.env file (secure, not committed to git)
 */
function saveApiKey(apiKey: string): void {
  try {
    const dir = path.dirname(ENV_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Read existing .env content
    let envContent = '';
    if (fs.existsSync(ENV_PATH)) {
      envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    }

    // Update or add LINEAR_API_KEY
    const lines = envContent.split('\n');
    let found = false;
    const updatedLines = lines.map(line => {
      if (line.trim().startsWith('LINEAR_API_KEY=')) {
        found = true;
        return `LINEAR_API_KEY=${apiKey}`;
      }
      return line;
    });

    if (!found) {
      updatedLines.push(`LINEAR_API_KEY=${apiKey}`);
    }

    fs.writeFileSync(ENV_PATH, updatedLines.join('\n'), 'utf-8');
    // Set restrictive permissions (owner read/write only)
    fs.chmodSync(ENV_PATH, 0o600);

    // Also set in current process env
    process.env.LINEAR_API_KEY = apiKey;
  } catch (error) {
    console.error('[useViewMode] Failed to save API key:', error);
  }
}

/**
 * Save config to ~/.clive/config.json
 * API keys are saved separately in ~/.clive/.env for security
 */
function saveConfig(config: IssueTrackerConfig): void {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Extract API key if present and save separately
    const configToSave = { ...config };
    if (configToSave.linear?.apiKey) {
      saveApiKey(configToSave.linear.apiKey);
      // Remove apiKey from config before saving
      delete configToSave.linear.apiKey;
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToSave, null, 2), 'utf-8');
  } catch (error) {
    console.error('[useViewMode] Failed to save config:', error);
  }
}

/**
 * View Mode State Machine
 * Flow: setup -> selection -> main <-> help
 */
const viewModeMachine = setup({
  types: {
    context: {} as {
      config: IssueTrackerConfig | null;
      previousView: ViewMode | null;
    },
    events: {} as
      | { type: 'GO_TO_SETUP' }
      | { type: 'GO_TO_SELECTION' }
      | { type: 'GO_TO_MAIN' }
      | { type: 'GO_TO_HELP' }
      | { type: 'GO_BACK' }
      | { type: 'UPDATE_CONFIG'; config: IssueTrackerConfig },
  },
  actions: {
    savePreviousView: assign({
      previousView: ({ context }, currentState: ViewMode) => currentState as ViewMode,
    }),
    updateConfig: assign({
      config: ({ event }) => {
        if (event.type !== 'UPDATE_CONFIG') return null;
        saveConfig(event.config);
        return event.config;
      },
    }),
  },
}).createMachine({
  id: 'viewMode',
  initial: 'setup',
  context: {
    config: null,
    previousView: null,
  },
  states: {
    setup: {
      on: {
        GO_TO_SELECTION: 'selection',
        GO_TO_MAIN: 'main',
        UPDATE_CONFIG: {
          target: 'selection',
          actions: 'updateConfig',
        },
      },
    },
    selection: {
      on: {
        GO_TO_SETUP: 'setup',
        GO_TO_MAIN: 'main',
        GO_TO_HELP: {
          target: 'help',
          actions: assign({
            previousView: 'selection',
          }),
        },
        GO_BACK: 'setup',
      },
    },
    main: {
      on: {
        GO_TO_SELECTION: 'selection',
        GO_TO_HELP: {
          target: 'help',
          actions: assign({
            previousView: 'main',
          }),
        },
        GO_BACK: 'selection',
      },
    },
    help: {
      on: {
        GO_BACK: [
          {
            target: 'main',
            guard: ({ context }) => context.previousView === 'main',
          },
          {
            target: 'selection',
            guard: ({ context }) => context.previousView === 'selection',
          },
          {
            target: 'setup',
            guard: ({ context }) => context.previousView === 'setup',
          },
        ],
      },
    },
  },
});

export interface ViewModeState {
  viewMode: ViewMode;
  config: IssueTrackerConfig | null;

  // Actions
  goToSetup: () => void;
  goToSelection: () => void;
  goToMain: () => void;
  goToHelp: () => void;
  goBack: () => void;
  updateConfig: (config: IssueTrackerConfig) => void;
}

export function useViewMode(): ViewModeState {
  // Load config and determine initial state
  const loadedConfig = loadConfig();

  const [state, send] = useMachine(viewModeMachine, {
    context: {
      config: loadedConfig,
      previousView: null,
    },
  });

  // Navigate to selection if config exists
  useEffect(() => {
    if (loadedConfig && loadedConfig.issueTracker && state.value === 'setup') {
      send({ type: 'GO_TO_SELECTION' });
    }
  }, []); // Only run once on mount

  // Determine current view mode from state
  const viewMode = state.value as ViewMode;

  return {
    viewMode,
    config: state.context.config,
    goToSetup: () => send({ type: 'GO_TO_SETUP' }),
    goToSelection: () => send({ type: 'GO_TO_SELECTION' }),
    goToMain: () => send({ type: 'GO_TO_MAIN' }),
    goToHelp: () => send({ type: 'GO_TO_HELP' }),
    goBack: () => send({ type: 'GO_BACK' }),
    updateConfig: (config: IssueTrackerConfig) => send({ type: 'UPDATE_CONFIG', config }),
  };
}
