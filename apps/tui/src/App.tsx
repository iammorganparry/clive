/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 * View flow: Setup -> Selection -> ModeSelection -> Main <-> Help
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTerminalDimensions, useKeyboard, extend } from '@opentui/react';
import { GhosttyTerminalRenderable } from 'ghostty-opentui/terminal-buffer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';

// Derive clive root from this file's location
// This file is at: <clive-root>/apps/tui/src/App.tsx
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIVE_ROOT = join(__dirname, '..', '..', '..');

// Get hooks configuration object with absolute paths
// Hooks are configured via .claude/settings.local.json, not CLI args
function getHooksConfig() {
  const hooksDir = join(CLIVE_ROOT, 'apps', 'claude-code-plugin', 'hooks');
  return {
    PostToolUse: [
      {
        matcher: 'mcp__linear__update_issue',
        hooks: [
          {
            type: 'command',
            command: join(hooksDir, 'linear-issue-updated-hook.sh'),
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: join(hooksDir, 'stop-hook.sh'),
          },
        ],
      },
    ],
  };
}

// Ensure Clive's working directories are in .gitignore
function ensureGitignoreEntries(workspaceRoot: string): void {
  const gitignorePath = join(workspaceRoot, '.gitignore');

  // Only modify if .gitignore exists (don't create one)
  if (!existsSync(gitignorePath)) {
    return;
  }

  const entriesToAdd = [
    '# Clive working files',
    '.claude/settings.local.json',
    '.claude/.restart-session',
    '.claude/.parent-issue-id',
    '.claude/.test-loop-state',
    '.claude/.test-plan-path',
    '.claude/.test-max-iterations',
    '.claude/.linear-updated',
    '.claude/.cancel-test-loop',
    '.claude/current-plan.md',
    '.claude/progress.txt',
  ];

  try {
    let content = readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n');

    // Check which entries are missing
    const missingEntries = entriesToAdd.filter(entry => {
      // Skip comment lines when checking
      if (entry.startsWith('#')) {
        return !content.includes(entry);
      }
      // Check if the pattern exists (exact match or with trailing newline/space)
      return !lines.some(line => line.trim() === entry);
    });

    if (missingEntries.length > 0) {
      // Add a newline if file doesn't end with one
      if (content.length > 0 && !content.endsWith('\n')) {
        content += '\n';
      }
      // Add blank line before our section if there's content
      if (content.trim().length > 0) {
        content += '\n';
      }
      content += missingEntries.join('\n') + '\n';
      writeFileSync(gitignorePath, content);
    }
  } catch {
    // Silently fail - gitignore is not critical
  }
}

// Ensure hooks are configured - try workspace first, fall back to global
function ensureHooksConfigured(workspaceRoot: string): void {
  const hooksConfig = getHooksConfig();

  // Try workspace .claude directory first
  const workspaceClaudeDir = join(workspaceRoot, '.claude');
  const workspaceSettingsPath = join(workspaceClaudeDir, 'settings.local.json');

  // Fall back to global ~/.claude if workspace doesn't have .claude dir
  const globalClaudeDir = join(homedir(), '.claude');
  const globalSettingsPath = join(globalClaudeDir, 'settings.json');

  // Determine which to use - prefer workspace if it exists or can be created
  let targetDir: string;
  let targetPath: string;

  if (existsSync(workspaceClaudeDir) || existsSync(join(workspaceRoot, '.git'))) {
    // Use workspace settings if .claude exists or this is a git repo
    targetDir = workspaceClaudeDir;
    targetPath = workspaceSettingsPath;
  } else {
    // Fall back to global settings
    targetDir = globalClaudeDir;
    targetPath = globalSettingsPath;
  }

  mkdirSync(targetDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    if (existsSync(targetPath)) {
      const existing = readFileSync(targetPath, 'utf-8');
      settings = JSON.parse(existing);
    }
  } catch {
    // File doesn't exist or invalid JSON, start fresh
  }

  // Merge hooks config (don't overwrite other settings)
  settings.hooks = hooksConfig;

  writeFileSync(targetPath, JSON.stringify(settings, null, 2));
}

// Ensure hook scripts are executable
function ensureHookScriptsExecutable(): void {
  const hooksDir = join(CLIVE_ROOT, 'apps', 'claude-code-plugin', 'hooks');
  const scripts = ['stop-hook.sh', 'linear-issue-updated-hook.sh'];

  for (const script of scripts) {
    const scriptPath = join(hooksDir, script);
    if (existsSync(scriptPath)) {
      try {
        chmodSync(scriptPath, 0o755);
      } catch {
        // Silently fail - might not have permission
      }
    }
  }
}

// Register ghostty-terminal component for terminal emulation
extend({ 'ghostty-terminal': GhosttyTerminalRenderable });
import { OneDarkPro } from './styles/theme';
import { useAppState } from './hooks/useAppState';
import { useViewMode } from './hooks/useViewMode';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { SetupView } from './components/SetupView';
import { SelectionView } from './components/SelectionView';
import { ModeSelectionView } from './components/ModeSelectionView';
import { ReviewCredentialsView } from './components/ReviewCredentialsView';
import { PtyOutputPanel, type PtyOutputPanelRef } from './components/PtyOutputPanel';
import { HelpView } from './components/HelpView';
import { LinearConfigFlow } from './components/LinearConfigFlow';
import { GitHubConfigFlow } from './components/GitHubConfigFlow';
import { type Conversation } from './services/ConversationService';
import { PtyCliManager, type PtyDimensions } from './services/PtyCliManager';
import { RestartSignalWatcher, type RestartSignal } from './services/RestartSignalWatcher';
import { useConversations, useAllConversations } from './hooks/useConversations';
import { useSelectionState } from './hooks/useSelectionState';
import { useLinearSync } from './hooks/useLinearSync';
import { usePaste } from './hooks/usePaste';
import type { Session } from './types';
import type { CliveMode, ReviewCredentials } from './types/views';

// Create QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent() {
  // Terminal dimensions (responsive to terminal size)
  const { width, height } = useTerminalDimensions();

  // View mode management
  const {
    viewMode,
    config,
    goToSetup,
    goToSelection,
    goToModeSelection,
    goToReviewCredentials,
    goToMain,
    goToHelp,
    goBack,
    updateConfig,
  } = useViewMode();

  // Setup view state
  const [setupSelectedIndex, setSetupSelectedIndex] = useState(0);
  const setupOptions = ['linear', 'beads'];
  const [configFlow, setConfigFlow] = useState<'linear' | 'beads' | null>(null);

  // Mode selection state
  const [modeSelectedIndex, setModeSelectedIndex] = useState(0);
  const [pendingSession, setPendingSession] = useState<Session | null>(null);
  const [pendingConversation, setPendingConversation] = useState<Conversation | null>(null);
  const [selectedMode, setSelectedMode] = useState<CliveMode | null>(null);
  const [reviewCredentials, setReviewCredentials] = useState<ReviewCredentials>(() => {
    // Load saved credentials from project config on initialization
    const configPath = `${process.env.CLIVE_WORKSPACE || process.cwd()}/.claude/review-config.json`;
    try {
      if (existsSync(configPath)) {
        const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
        return saved as ReviewCredentials;
      }
    } catch {
      // Ignore errors, use defaults
    }
    return {
      baseUrl: 'http://localhost:3000',
      skipAuth: false,
    };
  });

  // PTY manager for direct TTY rendering
  const ptyManager = useRef<PtyCliManager | null>(null);
  const ptyOutputPanelRef = useRef<PtyOutputPanelRef>(null);
  const [ansiBuffer, setAnsiBuffer] = useState('');
  const [isPtyRunning, setIsPtyRunning] = useState(false);
  const [ptyDimensions, setPtyDimensions] = useState<PtyDimensions | null>(null);

  // Restart signal watcher for fresh context restarts
  const restartWatcher = useRef<RestartSignalWatcher | null>(null);

  // Input focus state (kept for potential future use and config flows)
  const [inputFocused, setInputFocused] = useState(false);

  // State management
  // Get workspace root from user's current terminal directory
  // In development, this can be overridden via --workspace flag
  const workspaceRoot = process.env.CLIVE_WORKSPACE || process.cwd();

  // Log workspace context on startup
  useEffect(() => {
    console.log('[Clive TUI] Starting in workspace:', workspaceRoot);
    console.log('[Clive TUI] Claude will have context of this directory');
    if (process.env.CLIVE_WORKSPACE) {
      console.log('[Clive TUI] Workspace overridden via --workspace flag (dev mode)');
    }
  }, [workspaceRoot]);

  // Fetch ALL conversations across all projects (not just current workspace)
  // This ensures "Other Conversations" shows all Claude Code conversations
  const {
    data: conversations = [],
    isLoading: conversationsLoading,
  } = useAllConversations(100);

  // useAppState still provides sessions and tasks for the sidebar and selection view
  // PTY rendering replaces outputLines, pendingQuestion, etc.
  const {
    sessions,
    sessionsLoading,
    sessionsError,
    tasks,
    activeSession,
    setActiveSession,
    cleanup,
  } = useAppState(workspaceRoot, config?.issueTracker);

  // Selection state using XState machine
  const selectionState = useSelectionState(sessions, conversations);

  // Real-time Linear sync when PTY is running
  // Polls Linear for task status changes and updates sidebar
  useLinearSync({
    parentIssueId: activeSession?.linearData?.id || null,
    enabled: isPtyRunning && config?.issueTracker === 'linear',
  });

  // Restart signal handling - watches for fresh context restart signals from stop hook
  useEffect(() => {
    // Initialize the watcher if not already done
    if (!restartWatcher.current && workspaceRoot) {
      restartWatcher.current = new RestartSignalWatcher(workspaceRoot);

      restartWatcher.current.on('restart', async (signal: RestartSignal) => {
        console.log('[Clive TUI] Restart signal received:', signal);

        if (ptyManager.current && isPtyRunning) {
          // Kill current session
          ptyManager.current.kill();
          // Wait a moment for the PTY to fully terminate
          await new Promise(resolve => setTimeout(resolve, 200));

          // Clear state
          setAnsiBuffer('');
          setPtyDimensions(null);

          // Start new session with fresh context
          // Ensure hooks are configured and gitignore is updated
          ensureHooksConfigured(workspaceRoot);
          ensureHookScriptsExecutable();
          ensureGitignoreEntries(workspaceRoot);

          const ptyOptions = {
            workspaceRoot,
            model: 'opus',
            mode: signal.mode || selectedMode || 'build',
          };

          // Mark as running before starting
          setIsPtyRunning(true);

          console.log('[Clive TUI] Starting fresh session for iteration', signal.context?.iteration);

          const mode = signal.mode || selectedMode;
          const skillCmd = mode === 'plan'
            ? '/clive:plan'
            : mode === 'build'
              ? '/clive:build'
              : '/clive:review';

          // Track if command was sent
          let commandSent = false;

          // Set up listener for input-ready event
          const onInputReady = () => {
            if (commandSent) return;
            commandSent = true;
            console.log('[Clive TUI] Claude Code ready, injecting skill command:', skillCmd);
            ptyManager.current?.sendInput(skillCmd);
            ptyManager.current?.off('input-ready', onInputReady);
          };
          ptyManager.current.on('input-ready', onInputReady);

          await ptyManager.current.execute('', ptyOptions);

          // Fallback timeout in case input-ready detection fails
          setTimeout(() => {
            if (commandSent) return;
            commandSent = true;
            ptyManager.current?.off('input-ready', onInputReady);
            console.log('[Clive TUI] Fallback: injecting skill command after timeout');
            ptyManager.current?.sendInput(skillCmd);
          }, 3000);
        }
      });
    }

    // Start/stop watcher based on PTY state
    if (isPtyRunning && restartWatcher.current) {
      restartWatcher.current.start();
    } else if (!isPtyRunning && restartWatcher.current) {
      restartWatcher.current.stop();
    }

    return () => {
      // Cleanup on unmount
      restartWatcher.current?.stop();
    };
  }, [workspaceRoot, isPtyRunning, selectedMode]);

  // Auto-resume if exactly 1 conversation
  useEffect(() => {
    // Only auto-resume when in selection view and conversations are loaded
    if (viewMode !== 'selection' || conversationsLoading || sessionsLoading) {
      return;
    }

    // If exactly 1 conversation and no sessions, go to mode selection for it
    if (conversations.length === 1 && sessions.length === 0) {
      const conversation = conversations[0];
      if (conversation) {
        // Instead of auto-resuming, go to mode selection
        handleConversationResume(conversation);
      }
      return;
    }

    // Otherwise, always show the selection view (including when 0 conversations)
  }, [viewMode, conversations.length, sessions.length, conversationsLoading, sessionsLoading]);

  // Cleanup on process exit (only 'exit' event, SIGINT/SIGTERM handled by main.tsx)
  useEffect(() => {
    const handleExit = () => {
      cleanup();
      if (ptyManager.current) {
        ptyManager.current.kill();
      }
    };

    process.on('exit', handleExit);

    return () => {
      process.off('exit', handleExit);
    };
  }, [cleanup]);

  // Initialize PTY manager
  useEffect(() => {
    if (!ptyManager.current) {
      ptyManager.current = new PtyCliManager();

      // Listen for PTY output - update the ANSI buffer for rendering
      ptyManager.current.on('output', ({ ansi }: { ansi: string }) => {
        setAnsiBuffer(ansi);
      });

      // Listen for PTY completion
      ptyManager.current.on('complete', () => {
        console.log('[Clive TUI] PTY complete');
        setIsPtyRunning(false);
        setSelectedMode(null);
        setAnsiBuffer('');
        setPtyDimensions(null);
        // Go back to selection view
        goToSelection();
      });

      // Listen for PTY kill
      ptyManager.current.on('killed', () => {
        console.log('[Clive TUI] PTY killed');
        setIsPtyRunning(false);
        setSelectedMode(null);
        setAnsiBuffer('');
        setPtyDimensions(null);
        // Go back to selection view
        goToSelection();
      });

      // Listen for PTY dimensions changes (for responsive rendering)
      ptyManager.current.on('dimensions', (dimensions: PtyDimensions) => {
        setPtyDimensions(dimensions);
      });
    }

    return () => {
      if (ptyManager.current) {
        ptyManager.current.kill();
        ptyManager.current.removeAllListeners();
        ptyManager.current = null;
      }
    };
  }, []);

  // Handle terminal resize - sync PTY dimensions with terminal
  useEffect(() => {
    if (ptyManager.current && isPtyRunning) {
      ptyManager.current.resize(width, height);
    }
  }, [width, height, isPtyRunning]);


  // Keyboard handling using OpenTUI's useKeyboard hook
  // This properly integrates with OpenTUI's stdin management
  useKeyboard((event) => {
    // Skip ALL keyboard handling when input is focused - let input handle everything
    if (inputFocused) {
      // ONLY handle unfocus events
      if (event.name === 'escape') {
        setInputFocused(false);
      }
      return; // Exit early, don't process any other keys
    }

    // Skip keyboard handling in config flows
    if (configFlow === 'linear' || configFlow === 'beads') {
      return;
    }

    // Global shortcuts
    if (event.sequence === 'q' && viewMode !== 'main') {
      process.exit(0);
    }

    if (event.sequence === '?') {
      if (viewMode === 'help') {
        goBack();
      } else {
        goToHelp();
      }
      return;
    }

    // View-specific shortcuts
    if (viewMode === 'setup' && !configFlow) {
      if (event.name === 'escape') {
        process.exit(0);
      }
      // Arrow key navigation for setup options
      if (event.name === 'up' || event.sequence === 'k') {
        setSetupSelectedIndex((prev) => (prev > 0 ? prev - 1 : setupOptions.length - 1));
      }
      if (event.name === 'down' || event.sequence === 'j') {
        setSetupSelectedIndex((prev) => (prev < setupOptions.length - 1 ? prev + 1 : 0));
      }
      // Number key selection (1, 2, etc.)
      if (event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence) - 1;
        if (index < setupOptions.length) {
          const selectedOption = setupOptions[index];
          if (selectedOption === 'linear') {
            setConfigFlow('linear');
          } else if (selectedOption === 'beads') {
            setConfigFlow('beads');
          }
        }
      }
      if (event.name === 'return') {
        const selectedOption = setupOptions[setupSelectedIndex];
        if (selectedOption === 'linear') {
          setConfigFlow('linear');
        } else if (selectedOption === 'beads') {
          setConfigFlow('beads');
        }
      }
    } else if (viewMode === 'selection') {
      // Escape - clear search, go back to level 1, or go back
      if (event.name === 'escape') {
        if (selectionState.searchQuery) {
          // Clear search
          selectionState.clearSearch();
        } else if (selectionState.isLevel2) {
          // Go back to level 1 (issues)
          selectionState.goBack();
        } else {
          // Go back to previous view
          goBack();
        }
        return;
      }

      // Backspace - remove last character from search
      if (event.name === 'backspace') {
        if (selectionState.searchQuery) {
          selectionState.search(selectionState.searchQuery.slice(0, -1));
        }
        return;
      }

      // Printable characters - add to search query
      if (
        event.sequence &&
        event.sequence.length === 1 &&
        !event.ctrl &&
        !event.meta &&
        event.name !== 'up' &&
        event.name !== 'down' &&
        event.name !== 'return' &&
        event.name !== 'enter' &&
        event.name !== 'escape' &&
        event.name !== 'backspace'
      ) {
        selectionState.search(selectionState.searchQuery + event.sequence);
        return;
      }

      // Arrow key navigation
      if (event.name === 'up' || event.sequence === 'k') {
        selectionState.navigateUp();
        return;
      }
      if (event.name === 'down' || event.sequence === 'j') {
        selectionState.navigateDown();
        return;
      }

      // Enter to select
      if (event.name === 'return' || event.name === 'enter') {
        if (selectionState.isLevel1) {
          // Level 1: Selecting an issue
          if (selectionState.selectedIndex === -1) {
            // Create new session without issue
            handleCreateNewWithoutIssue();
            return;
          }

          // Include "Other Conversations" group in the list (at the TOP to match SelectionView)
          const issuesWithOther: Session[] = [];
          const unattachedCount = conversations.filter(c => !c.linearProjectId && !c.linearTaskId).length;
          if (unattachedCount > 0) {
            // Add "Other Conversations" at the TOP
            issuesWithOther.push({
              id: '__unattached__',
              name: `Other Conversations (${unattachedCount})`,
              createdAt: new Date(),
              source: 'linear' as const,
            });
          }
          // Add all Linear sessions after
          issuesWithOther.push(...sessions);

          const filteredSessions = selectionState.searchQuery
            ? issuesWithOther.filter(s => {
                const query = selectionState.searchQuery.toLowerCase();
                const identifier = s.linearData?.identifier?.toLowerCase() || '';
                const title = s.name.toLowerCase();
                return identifier.includes(query) || title.includes(query);
              })
            : issuesWithOther;

          const displayIssues = filteredSessions.slice(0, 10);
          const issue = displayIssues[selectionState.selectedIndex];
          if (issue) {
            // Go to Level 2 - show conversations for this issue
            selectionState.selectIssue(issue);
          }
        } else if (selectionState.isLevel2) {
          // Level 2: Selecting a conversation for the issue
          if (selectionState.selectedIndex === -1) {
            // Create new session for this issue
            if (selectionState.selectedIssue) {
              handleCreateNewForIssue(selectionState.selectedIssue);
            }
            return;
          }

          if (!selectionState.selectedIssue) return;

          // Check if this is the "Other Conversations" group
          const selectedIssue = selectionState.selectedIssue;
          const isUnattachedGroup = selectedIssue.id === '__unattached__';

          const conversationsForIssue = isUnattachedGroup
            ? conversations.filter(c => !c.linearProjectId && !c.linearTaskId)
            : conversations.filter(c => {
                const issueLinearId = selectedIssue.linearData?.id;
                return c.linearProjectId === issueLinearId || c.linearTaskId === issueLinearId;
              });

          const filteredConversations = selectionState.searchQuery
            ? conversationsForIssue.filter(c => {
                const query = selectionState.searchQuery.toLowerCase();
                const display = c.display.toLowerCase();
                const slug = c.slug?.toLowerCase() || '';
                return display.includes(query) || slug.includes(query);
              })
            : conversationsForIssue;

          const displayConversations = filteredConversations.slice(0, 10);
          const conversation = displayConversations[selectionState.selectedIndex];
          if (conversation) {
            handleConversationResume(conversation);
          }
        }
        return;
      }
    } else if (viewMode === 'modeSelection') {
      // Mode selection view keyboard handling
      if (event.name === 'escape') {
        // Clear pending session/conversation and go back to selection
        setPendingSession(null);
        setPendingConversation(null);
        setModeSelectedIndex(0);
        goBack();
        return;
      }

      // Arrow key navigation (3 options: plan, build, review)
      if (event.name === 'up' || event.sequence === 'k') {
        setModeSelectedIndex((prev) => (prev > 0 ? prev - 1 : 2));
        return;
      }
      if (event.name === 'down' || event.sequence === 'j') {
        setModeSelectedIndex((prev) => (prev < 2 ? prev + 1 : 0));
        return;
      }

      // Quick select with number keys
      if (event.sequence === '1') {
        handleModeSelected('plan');
        return;
      }
      if (event.sequence === '2') {
        handleModeSelected('build');
        return;
      }
      if (event.sequence === '3') {
        handleModeSelected('review');
        return;
      }

      // Enter to confirm selection
      if (event.name === 'return' || event.name === 'enter') {
        const modes: CliveMode[] = ['plan', 'build', 'review'];
        const mode = modes[modeSelectedIndex] || 'plan';
        handleModeSelected(mode);
        return;
      }
    } else if (viewMode === 'main') {
      // Intercept scroll control shortcuts BEFORE PTY passthrough
      // Ctrl+G produces ASCII 7 (BEL) - check both name and sequence
      const isCtrlG = (event.ctrl && event.name === 'g') ||
                      event.sequence === '\x07' ||
                      event.name === 'C-g';
      if (isCtrlG) {
        // Jump to bottom and re-enable auto-scroll
        ptyOutputPanelRef.current?.scrollToBottom();
        return; // Don't pass to PTY
      }

      // In main view with PTY active, pass all input directly to PTY
      if (isPtyRunning && ptyManager.current) {
        // Pass raw input sequences directly to PTY
        if (event.sequence) {
          ptyManager.current.sendRawInput(event.sequence);
        }
        return;
      }

      // Not running PTY - handle escape to go back
      if (event.name === 'escape') {
        // Double-escape or Esc when idle returns to mode selection
        goBack();
        return;
      }

      if (event.ctrl && event.name === 'c') {
        // Two-stage Ctrl+C handling:
        // 1. First Ctrl+C: Kill active PTY session
        // 2. Second Ctrl+C (when idle): Exit Clive
        if (isPtyRunning && ptyManager.current) {
          // PTY is active - interrupt it
          ptyManager.current.interrupt();
        } else {
          // No active session - exit Clive immediately
          cleanup();
          if (ptyManager.current) {
            ptyManager.current.kill();
          }
          process.exit(0);
        }
        return;
      }
    } else if (viewMode === 'help') {
      if (event.name === 'escape') {
        goBack();
      }
    }
  });

  // Handle paste events - forward to PTY when in main view
  usePaste(useCallback((event) => {
    if (viewMode === 'main' && isPtyRunning && ptyManager.current) {
      // Forward pasted text directly to PTY
      ptyManager.current.sendRawInput(event.text);
    }
  }, [viewMode, isPtyRunning]));

  // Handler for creating new session without issue
  const handleCreateNewWithoutIssue = () => {
    setPendingSession(null);
    setPendingConversation(null);
    setModeSelectedIndex(0);
    goToModeSelection();
  };

  // Handler for creating new session for specific issue
  const handleCreateNewForIssue = (issue: Session) => {
    setActiveSession(issue);
    setPendingSession(issue);
    setPendingConversation(null);
    setModeSelectedIndex(0);
    goToModeSelection();
  };

  // Handler for conversation resume
  const handleConversationResume = (conversation: Conversation) => {
    console.log('[Clive TUI] Setting up resume for conversation:', conversation.sessionId);
    setPendingConversation(conversation);
    setPendingSession(null);
    setModeSelectedIndex(0);
    goToModeSelection();
  };

  // Handler for mode selection
  const handleModeSelected = useCallback(async (mode: CliveMode) => {
    console.log('[Clive TUI] Mode selected:', mode);
    setSelectedMode(mode);

    // For review mode, check if credentials are configured
    // If not, go to credentials view first
    if (mode === 'review') {
      const configPath = `${workspaceRoot}/.claude/review-config.json`;
      let hasCredentials = false;
      try {
        if (existsSync(configPath)) {
          const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
          // Consider configured if baseUrl exists
          hasCredentials = !!saved.baseUrl;
          if (hasCredentials) {
            setReviewCredentials(saved);
          }
        }
      } catch {
        // Ignore errors
      }

      if (!hasCredentials) {
        // Go to credentials setup first
        goToReviewCredentials();
        return;
      }
    }

    // Build the skill command
    const skillCommand = mode === 'plan' ? '/clive:plan' : mode === 'build' ? '/clive:build' : '/clive:review';

    // Get the selected issue data from pending session or active session
    const selectedIssue = pendingSession || activeSession;
    const issueIdentifier = selectedIssue?.linearData?.identifier;

    // Clear ANSI buffer
    setAnsiBuffer('');

    // Go to main view
    goToMain();

    // Start PTY with the skill command prepopulated
    if (ptyManager.current) {
      setIsPtyRunning(true);

      // Use buffered mode - PTY output is captured and rendered via ghostty-terminal
      // This provides proper layout with sidebar while maintaining ANSI colors

      console.log('[Clive TUI] Starting PTY in buffered mode', {
        issueIdentifier,
        selectedIssue: selectedIssue?.name,
      });

      // Write session context file for Claude to read
      // This provides context about the selected issue without passing it as an argument
      const contextDir = `${workspaceRoot}/.claude`;
      const contextFile = `${contextDir}/session-context.json`;
      const parentIssueFile = `${contextDir}/.parent-issue-id`;

      // Build context object
      const context: Record<string, unknown> = {
        selectedAt: new Date().toISOString(),
        mode,
      };

      // Add review credentials for review mode
      if (mode === 'review') {
        context.reviewCredentials = reviewCredentials;
      }

      // Add issue context if available
      if (selectedIssue?.linearData) {
        context.issue = {
          id: selectedIssue.linearData.id,
          identifier: selectedIssue.linearData.identifier,
          title: selectedIssue.name,
          url: selectedIssue.linearData.url,
          state: selectedIssue.linearData.state,
          priority: selectedIssue.linearData.priority,
          labels: selectedIssue.linearData.labels,
        };
      }

      try {
        const fs = await import('node:fs/promises');
        await fs.mkdir(contextDir, { recursive: true });
        await fs.writeFile(contextFile, JSON.stringify(context, null, 2));
        console.log('[Clive TUI] Wrote session context to', contextFile);

        // Write parent issue ID for Linear sync in stop hook
        if (selectedIssue?.linearData) {
          await fs.writeFile(parentIssueFile, selectedIssue.linearData.id);
          console.log('[Clive TUI] Wrote parent issue ID to', parentIssueFile);
        }
      } catch (err) {
        console.error('[Clive TUI] Failed to write session context:', err);
      }

      // Ensure hooks are configured and gitignore is updated
      ensureHooksConfigured(workspaceRoot);
      ensureHookScriptsExecutable();
      ensureGitignoreEntries(workspaceRoot);

      const ptyOptions = {
        workspaceRoot,
        model: 'opus', // Use Opus for both planning and building
        mode,
      };

      // Build the full command - no need to pass issue identifier since context file has it
      let fullCommand = skillCommand;

      // If resuming a conversation, add --resume flag
      if (pendingConversation) {
        fullCommand += ` --resume=${pendingConversation.sessionId}`;
      }

      // Track if command was sent to avoid double-sending
      let commandSent = false;

      // Set up one-time listener for input-ready event
      const onInputReady = () => {
        if (commandSent) return;
        commandSent = true;
        console.log('[Clive TUI] Claude Code ready, sending command:', fullCommand);
        ptyManager.current?.sendInput(fullCommand);
        ptyManager.current?.off('input-ready', onInputReady);
      };
      ptyManager.current.on('input-ready', onInputReady);

      // Start PTY execution - command will be sent when input-ready fires
      await ptyManager.current.execute('', ptyOptions);

      // Fallback timeout in case input-ready detection fails
      setTimeout(() => {
        if (commandSent) return;
        commandSent = true;
        ptyManager.current?.off('input-ready', onInputReady);
        console.log('[Clive TUI] Fallback: sending command after timeout');
        ptyManager.current?.sendInput(fullCommand);
      }, 3000);
    }

    // Clear pending state
    setPendingSession(null);
    setPendingConversation(null);
  }, [workspaceRoot, goToMain, goToReviewCredentials, pendingConversation, pendingSession, activeSession, reviewCredentials]);

  // Handler for review credentials submission
  const handleReviewCredentialsSubmit = useCallback(async (credentials: ReviewCredentials) => {
    console.log('[Clive TUI] Review credentials submitted');

    // Save credentials to project config
    const configDir = `${workspaceRoot}/.claude`;
    const configPath = `${configDir}/review-config.json`;
    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(credentials, null, 2));
      console.log('[Clive TUI] Saved review credentials to', configPath);
    } catch (err) {
      console.error('[Clive TUI] Failed to save review credentials:', err);
    }

    // Update state
    setReviewCredentials(credentials);

    // Now start the review session
    // Call handleModeSelected again with 'review' - it will find the credentials now
    // Go to main view first
    goToMain();

    // Start PTY with review command
    if (ptyManager.current) {
      setIsPtyRunning(true);

      const selectedIssue = pendingSession || activeSession;

      // Write session context file with review credentials
      const contextDir = `${workspaceRoot}/.claude`;
      const contextFile = `${contextDir}/session-context.json`;
      const parentIssueFile = `${contextDir}/.parent-issue-id`;

      const context: Record<string, unknown> = {
        selectedAt: new Date().toISOString(),
        mode: 'review',
        reviewCredentials: credentials,
      };

      if (selectedIssue?.linearData) {
        context.issue = {
          id: selectedIssue.linearData.id,
          identifier: selectedIssue.linearData.identifier,
          title: selectedIssue.name,
          url: selectedIssue.linearData.url,
          state: selectedIssue.linearData.state,
          priority: selectedIssue.linearData.priority,
          labels: selectedIssue.linearData.labels,
        };
      }

      try {
        const fs = await import('node:fs/promises');
        await fs.mkdir(contextDir, { recursive: true });
        await fs.writeFile(contextFile, JSON.stringify(context, null, 2));
        console.log('[Clive TUI] Wrote session context with review credentials to', contextFile);

        if (selectedIssue?.linearData) {
          await fs.writeFile(parentIssueFile, selectedIssue.linearData.id);
        }
      } catch (err) {
        console.error('[Clive TUI] Failed to write session context:', err);
      }

      // Ensure hooks are configured
      ensureHooksConfigured(workspaceRoot);
      ensureHookScriptsExecutable();
      ensureGitignoreEntries(workspaceRoot);

      const ptyOptions = {
        workspaceRoot,
        model: 'opus',
        mode: 'review' as const,
      };

      let fullCommand = '/clive:review';
      if (pendingConversation) {
        fullCommand += ` --resume=${pendingConversation.sessionId}`;
      }

      let commandSent = false;
      const onInputReady = () => {
        if (commandSent) return;
        commandSent = true;
        console.log('[Clive TUI] Claude Code ready, sending review command:', fullCommand);
        ptyManager.current?.sendInput(fullCommand);
        ptyManager.current?.off('input-ready', onInputReady);
      };
      ptyManager.current.on('input-ready', onInputReady);

      await ptyManager.current.execute('', ptyOptions);

      setTimeout(() => {
        if (commandSent) return;
        commandSent = true;
        ptyManager.current?.off('input-ready', onInputReady);
        console.log('[Clive TUI] Fallback: sending review command after timeout');
        ptyManager.current?.sendInput(fullCommand);
      }, 3000);
    }

    // Clear pending state
    setPendingSession(null);
    setPendingConversation(null);
  }, [workspaceRoot, goToMain, pendingConversation, pendingSession, activeSession]);

  // Handler for config flow completion
  const handleConfigComplete = (config: { apiKey: string; teamID: string }) => {
    updateConfig({
      issueTracker: configFlow as 'linear' | 'beads',
      [configFlow as string]: config,
    });
    setConfigFlow(null);
    goToSelection();
  };

  // Render appropriate view based on viewMode
  if (viewMode === 'setup') {
    // Show config flow if a tracker was selected
    if (configFlow === 'linear') {
      return (
        <LinearConfigFlow
          width={width}
          height={height}
          onComplete={handleConfigComplete}
          onCancel={() => setConfigFlow(null)}
        />
      );
    }

    if (configFlow === 'beads') {
      // Beads doesn't need configuration, just update config and go to selection
      updateConfig({
        issueTracker: 'beads',
        beads: {},
      });
      setConfigFlow(null);
      goToSelection();
      return null;
    }

    // Show setup view
    return (
      <SetupView
        width={width}
        height={height}
        onComplete={updateConfig}
        onCancel={() => process.exit(0)}
        selectedIndex={setupSelectedIndex}
        onNavigate={setSetupSelectedIndex}
      />
    );
  }

  if (viewMode === 'selection') {
    return (
      <SelectionView
        width={width}
        height={height}
        sessions={sessions}
        conversations={conversations}
        sessionsLoading={sessionsLoading}
        conversationsLoading={conversationsLoading}
        sessionsError={sessionsError}
        conversationsError={null}
        selectedIndex={selectionState.selectedIndex}
        searchQuery={selectionState.searchQuery}
        selectedIssue={selectionState.selectedIssue}
        onSelectIssue={(issue) => {
          selectionState.selectIssue(issue);
        }}
        onResumeConversation={handleConversationResume}
        onCreateNew={(issue) => {
          if (issue) {
            handleCreateNewForIssue(issue);
          } else {
            handleCreateNewWithoutIssue();
          }
        }}
        onBack={() => {
          if (selectionState.isLevel2) {
            // Go back to Level 1
            selectionState.goBack();
          } else {
            // Go back to previous view
            goBack();
          }
        }}
      />
    );
  }

  if (viewMode === 'help') {
    return (
      <HelpView
        width={width}
        height={height}
        onClose={goBack}
      />
    );
  }

  if (viewMode === 'modeSelection') {
    return (
      <ModeSelectionView
        width={width}
        height={height}
        selectedIndex={modeSelectedIndex}
        sessionContext={pendingSession || activeSession}
        onSelectMode={handleModeSelected}
        onBack={() => {
          setPendingSession(null);
          setPendingConversation(null);
          setModeSelectedIndex(0);
          goBack();
        }}
      />
    );
  }

  if (viewMode === 'reviewCredentials') {
    return (
      <ReviewCredentialsView
        width={width}
        height={height}
        credentials={reviewCredentials}
        onSubmit={handleReviewCredentialsSubmit}
        onBack={goBack}
      />
    );
  }

  // Main view (PTY-based chat interface)
  // Uses buffered mode: PTY output captured and rendered via ghostty-terminal
  // This maintains proper layout with sidebar while preserving ANSI colors
  const isInMode = selectedMode !== null;
  const statusHeight = 1;

  // PTY mode: No input bar (Claude Code handles input natively)
  // Full screen to PTY output + sidebar + status bar
  const borderAdjustment = isInMode ? 2 : 0;
  const innerWidth = width - borderAdjustment;
  const innerHeight = height - borderAdjustment;
  const bodyHeight = innerHeight - statusHeight;

  // Sidebar layout
  const sidebarWidth = 30;
  const outputWidth = innerWidth - sidebarWidth;

  // Mode colors
  const getModeColor = () => {
    if (selectedMode === 'plan') return '#3B82F6'; // blue-500
    if (selectedMode === 'build') return '#F59E0B'; // amber-500
    if (selectedMode === 'review') return '#10B981'; // green-500
    return undefined;
  };

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      flexDirection="column"
      borderStyle={isInMode ? 'rounded' : undefined}
      borderColor={isInMode ? getModeColor() : undefined}
    >
      {/* Body (Sidebar + PTY Output) */}
      <box width={innerWidth} height={bodyHeight} flexDirection="row">
        {/* Sidebar */}
        <Sidebar
          width={sidebarWidth}
          height={bodyHeight}
          tasks={tasks}
          activeSession={activeSession}
        />

        {/* PTY Output Panel - Direct ANSI rendering from Claude Code */}
        <PtyOutputPanel
          ref={ptyOutputPanelRef}
          width={outputWidth}
          height={bodyHeight}
          ansiBuffer={ansiBuffer}
          mode={selectedMode}
          ptyDimensions={ptyDimensions}
        />
      </box>

      {/* Status Bar - Minimal, shows mode indicator and exit hint */}
      <StatusBar
        width={innerWidth}
        height={statusHeight}
        isRunning={isPtyRunning}
        inputFocused={false}
        workspaceRoot={workspaceRoot}
      />
    </box>
  );
}

// Main App with QueryClient provider
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
