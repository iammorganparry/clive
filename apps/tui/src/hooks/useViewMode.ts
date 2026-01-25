/**
 * useViewMode Hook
 * Manages view mode transitions using XState: Setup -> Selection -> Main <-> Help
 */

import { useEffect } from 'react';
import { setup, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import { ViewMode, IssueTrackerConfig, WorkerConfig } from '../types/views';
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
 * Merges sensitive credentials from ~/.clive/.env
 */
function loadConfig(): IssueTrackerConfig | null {
  // Load environment variables first
  loadEnvFile();

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(content) as IssueTrackerConfig;

      // Merge API key from env if present
      if (config.linear && process.env.LINEAR_API_KEY) {
        config.linear.apiKey = process.env.LINEAR_API_KEY;
      }

      // Merge worker token from env if worker config exists
      if (config.worker && process.env.CLIVE_WORKER_TOKEN) {
        config.worker.token = process.env.CLIVE_WORKER_TOKEN;
      }

      return config;
    }
  } catch (error) {
    console.error('[useViewMode] Failed to load config:', error);
  }
  return null;
}

/**
 * Save a sensitive value to ~/.clive/.env file
 * Handles multiple keys (LINEAR_API_KEY, CLIVE_WORKER_TOKEN, etc.)
 */
function saveEnvValue(key: string, value: string): void {
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

    // Update or add the key
    const lines = envContent.split('\n');
    let found = false;
    const updatedLines = lines.map(line => {
      if (line.trim().startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      // Filter out empty lines at the end before adding
      while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === '') {
        updatedLines.pop();
      }
      updatedLines.push(`${key}=${value}`);
    }

    fs.writeFileSync(ENV_PATH, updatedLines.join('\n'), 'utf-8');
    // Set restrictive permissions (owner read/write only)
    fs.chmodSync(ENV_PATH, 0o600);

    // Also set in current process env
    process.env[key] = value;
  } catch (error) {
    console.error(`[useViewMode] Failed to save ${key}:`, error);
  }
}

/**
 * Save API key to ~/.clive/.env file (secure, not committed to git)
 */
function saveApiKey(apiKey: string): void {
  saveEnvValue('LINEAR_API_KEY', apiKey);
}

/**
 * Save worker token to ~/.clive/.env file (secure, not committed to git)
 */
function saveWorkerToken(token: string): void {
  saveEnvValue('CLIVE_WORKER_TOKEN', token);
}

/**
 * Save config to ~/.clive/config.json
 * API keys and tokens are saved separately in ~/.clive/.env for security
 */
function saveConfig(config: IssueTrackerConfig): void {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Deep clone to avoid mutating the original
    const configToSave = JSON.parse(JSON.stringify(config)) as IssueTrackerConfig;

    // Extract API key if present and save separately
    if (configToSave.linear?.apiKey) {
      saveApiKey(configToSave.linear.apiKey);
      // Remove apiKey from config before saving
      delete (configToSave.linear as { apiKey?: string }).apiKey;
    }

    // Extract worker token if present and save separately
    if (configToSave.worker?.token) {
      saveWorkerToken(configToSave.worker.token);
      // Remove token from config before saving
      delete (configToSave.worker as { token?: string }).token;
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToSave, null, 2), 'utf-8');
  } catch (error) {
    console.error('[useViewMode] Failed to save config:', error);
  }
}

/**
 * View Mode State Machine
 * Flow: setup -> mode_selection -> (worker | selection -> main) <-> help
 */
const viewModeMachine = setup({
  types: {
    context: {} as {
      config: IssueTrackerConfig | null;
      previousView: ViewMode | null;
    },
    events: {} as
      | { type: 'GO_TO_SETUP' }
      | { type: 'GO_TO_MODE_SELECTION' }
      | { type: 'GO_TO_WORKER_SETUP' }
      | { type: 'GO_TO_WORKER' }
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
        GO_TO_MODE_SELECTION: 'mode_selection',
        GO_TO_SELECTION: 'selection',
        GO_TO_MAIN: 'main',
        UPDATE_CONFIG: {
          target: 'mode_selection',
          actions: 'updateConfig',
        },
      },
    },
    mode_selection: {
      on: {
        GO_TO_SETUP: 'setup',
        GO_TO_WORKER_SETUP: 'worker_setup',
        GO_TO_WORKER: 'worker',
        GO_TO_SELECTION: 'selection',
        GO_BACK: 'setup',
      },
    },
    worker_setup: {
      on: {
        GO_TO_MODE_SELECTION: 'mode_selection',
        GO_TO_WORKER: 'worker',
        GO_BACK: 'mode_selection',
        UPDATE_CONFIG: {
          target: 'worker',
          actions: 'updateConfig',
        },
      },
    },
    worker: {
      on: {
        GO_TO_MODE_SELECTION: 'mode_selection',
        GO_TO_HELP: {
          target: 'help',
          actions: assign({
            previousView: 'worker',
          }),
        },
        GO_BACK: 'mode_selection',
      },
    },
    selection: {
      on: {
        GO_TO_SETUP: 'setup',
        GO_TO_MODE_SELECTION: 'mode_selection',
        GO_TO_MAIN: 'main',
        GO_TO_HELP: {
          target: 'help',
          actions: assign({
            previousView: 'selection',
          }),
        },
        GO_BACK: 'mode_selection',
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
            target: 'worker',
            guard: ({ context }) => context.previousView === 'worker',
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
  goToModeSelection: () => void;
  goToWorkerSetup: () => void;
  goToWorker: () => void;
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

  // Navigate to mode_selection if config exists (issue tracker configured)
  useEffect(() => {
    if (loadedConfig && loadedConfig.issueTracker && state.value === 'setup') {
      send({ type: 'GO_TO_MODE_SELECTION' });
    }
  }, []); // Only run once on mount

  // Determine current view mode from state
  const viewMode = state.value as ViewMode;

  return {
    viewMode,
    config: state.context.config,
    goToSetup: () => send({ type: 'GO_TO_SETUP' }),
    goToModeSelection: () => send({ type: 'GO_TO_MODE_SELECTION' }),
    goToWorkerSetup: () => send({ type: 'GO_TO_WORKER_SETUP' }),
    goToWorker: () => send({ type: 'GO_TO_WORKER' }),
    goToSelection: () => send({ type: 'GO_TO_SELECTION' }),
    goToMain: () => send({ type: 'GO_TO_MAIN' }),
    goToHelp: () => send({ type: 'GO_TO_HELP' }),
    goBack: () => send({ type: 'GO_BACK' }),
    updateConfig: (config: IssueTrackerConfig) => send({ type: 'UPDATE_CONFIG', config }),
  };
}
