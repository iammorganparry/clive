/**
 * useAppState Hook
 * Central state management for the TUI application using XState
 * Manages CLI execution, output lines, and user interactions
 */

import { useEffect, useRef, useState } from 'react';
import { setup, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import { CliManager } from '../services/CliManager';
import { OutputLine, QuestionData, Session, Task } from '../types';
import { useSessions, useSessionTasks } from './useTaskQueries';

/**
 * TUI State Machine
 * States: idle, executing, waiting_for_answer
 */
const tuiMachine = setup({
  types: {
    context: {} as {
      outputLines: OutputLine[];
      pendingQuestion: QuestionData | null;
      workspaceRoot: string;
      cliManager: CliManager | null;
    },
    events: {} as
      | { type: 'EXECUTE'; prompt: string; mode: 'plan' | 'build' }
      | { type: 'OUTPUT'; line: OutputLine }
      | { type: 'QUESTION'; question: QuestionData }
      | { type: 'ANSWER'; answers: Record<string, string> }
      | { type: 'COMPLETE' }
      | { type: 'INTERRUPT' }
      | { type: 'CLEAR' }
      | { type: 'MESSAGE'; content: string },
  },
  actions: {
    addOutput: assign({
      outputLines: ({ context, event }) => {
        if (event.type !== 'OUTPUT') return context.outputLines;
        const newLines = [...context.outputLines, event.line];
        // Keep last 1000 lines
        return newLines.slice(-1000);
      },
    }),
    setQuestion: assign({
      pendingQuestion: ({ event }) => {
        if (event.type !== 'QUESTION') return null;
        return event.question;
      },
    }),
    clearQuestion: assign({
      pendingQuestion: null,
    }),
    clearOutput: assign({
      outputLines: [],
    }),
  },
}).createMachine({
  id: 'tui',
  initial: 'idle',
  context: {
    outputLines: [],
    pendingQuestion: null,
    workspaceRoot: process.cwd(),
    cliManager: null,
  },
  states: {
    idle: {
      on: {
        EXECUTE: {
          target: 'executing',
        },
        CLEAR: {
          actions: 'clearOutput',
        },
      },
    },
    executing: {
      on: {
        OUTPUT: {
          actions: 'addOutput',
        },
        QUESTION: {
          target: 'waiting_for_answer',
          actions: 'setQuestion',
        },
        COMPLETE: {
          target: 'idle',
        },
        INTERRUPT: {
          target: 'idle',
        },
        MESSAGE: {
          // Handle in-execution messages
        },
      },
    },
    waiting_for_answer: {
      on: {
        ANSWER: {
          target: 'executing',
          actions: 'clearQuestion',
        },
        INTERRUPT: {
          target: 'idle',
          actions: 'clearQuestion',
        },
      },
    },
  },
});

export interface AppState {
  // Output state
  outputLines: OutputLine[];
  isRunning: boolean;

  // Question state
  pendingQuestion: QuestionData | null;

  // Task/Session state
  sessions: Session[];
  tasks: Task[];
  activeSession: Session | null;
  sessionsLoading: boolean;
  tasksLoading: boolean;

  // Actions
  executeCommand: (cmd: string) => void;
  sendMessage: (msg: string) => void;
  handleQuestionAnswer: (answers: Record<string, string>) => void;
  clearOutput: () => void;
  interrupt: () => void;
  setActiveSession: (session: Session | null) => void;
}

export function useAppState(workspaceRoot: string): AppState {
  // Use XState machine
  const [state, send] = useMachine(tuiMachine, {
    context: {
      outputLines: [],
      pendingQuestion: null,
      workspaceRoot,
      cliManager: null,
    },
  });

  // CLI Manager instance
  const cliManager = useRef<CliManager | null>(null);

  // Active session tracking
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // React Query hooks for task/session data
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
  } = useSessions();

  const {
    data: tasks = [],
    isLoading: tasksLoading,
  } = useSessionTasks(activeSession?.id ?? null);

  // Initialize CLI Manager
  useEffect(() => {
    if (!cliManager.current) {
      cliManager.current = new CliManager();

      // Listen for output events
      cliManager.current.on('output', (line: OutputLine) => {
        // Handle special line types
        if (line.type === 'exit') {
          send({ type: 'OUTPUT', line });
          send({ type: 'COMPLETE' });
          return;
        }

        if (line.type === 'question' && line.question) {
          send({ type: 'QUESTION', question: line.question });
          return;
        }

        // Add regular output
        send({ type: 'OUTPUT', line });
      });

      // Listen for completion
      cliManager.current.on('complete', () => {
        send({ type: 'COMPLETE' });
      });

      // Listen for kill
      cliManager.current.on('killed', () => {
        send({ type: 'INTERRUPT' });
      });
    }

    // Cleanup on unmount
    return () => {
      if (cliManager.current) {
        cliManager.current.kill();
        cliManager.current.removeAllListeners();
      }
    };
  }, [send]);

  /**
   * Execute a command (slash command or message)
   */
  const executeCommand = (cmd: string) => {
    if (!cmd.trim() || !cliManager.current) return;

    // Handle slash commands
    if (cmd.startsWith('/')) {
      handleSlashCommand(cmd);
      return;
    }

    // If running, send as message
    if (state.matches('executing')) {
      cliManager.current.sendMessage(cmd);
      send({ type: 'MESSAGE', content: cmd });
    }
  };

  /**
   * Handle slash commands
   */
  const handleSlashCommand = (cmd: string) => {
    const parts = cmd.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case '/plan':
        startExecution(args || 'Create a plan for the current task', 'plan');
        break;

      case '/build':
        startExecution(args || 'Execute the plan', 'build');
        break;

      case '/clear':
        send({ type: 'CLEAR' });
        break;

      case '/cancel':
      case '/stop':
        interrupt();
        break;

      case '/help':
        showHelp();
        break;

      default:
        addSystemMessage(`Unknown command: ${command}`);
    }
  };

  /**
   * Start CLI execution with a prompt
   */
  const startExecution = async (prompt: string, mode: 'plan' | 'build') => {
    if (!cliManager.current || state.matches('executing')) return;

    send({ type: 'CLEAR' });
    addSystemMessage(`Starting ${mode} mode...`);
    send({ type: 'EXECUTE', prompt, mode });

    // Cache tasks before starting build
    if (mode === 'build' && activeSession && tasks.length > 0) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const os = await import('os');

        const epicDir = path.join(os.homedir(), '.claude', 'epics', activeSession.id);
        await fs.mkdir(epicDir, { recursive: true });

        const tasksFile = path.join(epicDir, 'tasks.json');
        await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
      } catch (error) {
        console.error('Failed to cache tasks:', error);
        addSystemMessage('Warning: Failed to cache tasks for build script');
      }
    }

    // Execute via CLI Manager
    cliManager.current.execute(prompt, {
      workspaceRoot,
      model: 'sonnet',
      systemPrompt: mode === 'plan'
        ? 'You are a planning assistant. Create a detailed plan.'
        : undefined,
    }).catch(error => {
      addSystemMessage(`Execution error: ${error}`);
      send({ type: 'COMPLETE' });
    });
  };

  /**
   * Send a message to the running CLI
   */
  const sendMessage = (msg: string) => {
    if (!cliManager.current || !state.matches('executing')) return;
    cliManager.current.sendMessage(msg);
    send({ type: 'MESSAGE', content: msg });
  };

  /**
   * Handle question answer
   */
  const handleQuestionAnswer = (answers: Record<string, string>) => {
    if (!cliManager.current || !state.context.pendingQuestion) return;

    // Send tool result back to CLI
    const answersJSON = JSON.stringify({ answers });
    cliManager.current.sendToolResult(state.context.pendingQuestion.toolUseID, answersJSON);

    send({ type: 'ANSWER', answers });
  };

  /**
   * Clear output
   */
  const clearOutput = () => {
    send({ type: 'CLEAR' });
    if (cliManager.current) {
      cliManager.current.clear();
    }
  };

  /**
   * Interrupt running execution
   */
  const interrupt = () => {
    if (cliManager.current) {
      cliManager.current.interrupt();
      addSystemMessage('Execution interrupted');
    }
    send({ type: 'INTERRUPT' });
  };

  /**
   * Helper: Add system message to output
   */
  const addSystemMessage = (text: string) => {
    send({
      type: 'OUTPUT',
      line: {
        text,
        type: 'system',
      },
    });
  };

  /**
   * Helper: Show help message
   */
  const showHelp = () => {
    const helpText = [
      'Clive TUI Commands:',
      '',
      '/plan [prompt]  - Create a plan',
      '/build [prompt] - Execute a task',
      '/clear         - Clear output',
      '/cancel        - Stop execution',
      '/help          - Show this help',
      '',
      'Keyboard Shortcuts:',
      'q / Esc        - Quit',
      'Ctrl+C         - Interrupt',
    ].join('\n');

    addSystemMessage(helpText);
  };

  return {
    // Output state
    outputLines: state.context.outputLines,
    isRunning: state.matches('executing') || state.matches('waiting_for_answer'),
    pendingQuestion: state.context.pendingQuestion,

    // Task/Session state
    sessions,
    tasks,
    activeSession,
    sessionsLoading,
    tasksLoading,

    // Actions
    executeCommand,
    sendMessage,
    handleQuestionAnswer,
    clearOutput,
    interrupt,
    setActiveSession,
  };
}
