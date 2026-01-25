/**
 * useAppState Hook
 * Central state management for the TUI application using XState
 * Manages CLI execution, output lines, and user interactions
 */

import { useEffect, useRef, useState } from 'react';
import { setup, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import { Effect, Runtime } from 'effect';
import { useQueryClient } from '@tanstack/react-query';
import { CliManager } from '../services/CliManager';
import { ConversationWatcher } from '../services/ConversationWatcher';
import { SessionMetadataService } from '../services/SessionMetadataService';
import { ConversationService } from '../services/ConversationService';
import { HistoryConverter } from '../services/HistoryConverter';
import { PromptService, PromptServiceLive } from '../services/prompts';
import type { BuildConfig } from '../services/prompts';
import type { OutputLine, QuestionData, Session, Task } from '../types';
import { useSessions, useSessionTasks, taskQueryKeys } from './useTaskQueries';
import { debugLog } from '../utils/debug-logger';

/**
 * TUI State Machine
 * States: idle, executing, waiting_for_answer
 */
const tuiMachine = setup({
  types: {
    context: {} as {
      outputLines: OutputLine[];
      pendingQuestion: QuestionData | null;
      questionQueue: QuestionData[]; // Queue for multiple questions
      workspaceRoot: string;
      cliManager: CliManager | null;
      mode: 'none' | 'plan' | 'build';
      agentSessionActive: boolean;
    },
    events: {} as
      | { type: 'EXECUTE'; prompt: string; mode: 'plan' | 'build' }
      | { type: 'OUTPUT'; line: OutputLine }
      | { type: 'QUESTION'; question: QuestionData }
      | { type: 'ANSWER'; answers: Record<string, string> }
      | { type: 'COMPLETE' }
      | { type: 'INTERRUPT' }
      | { type: 'EXIT_MODE' }
      | { type: 'CLEAR' }
      | { type: 'MESSAGE'; content: string },
  },
  actions: {
    updateOutput: assign({
      outputLines: ({ context, event }) => {
        if (event.type !== 'OUTPUT') return context.outputLines;
        return [...context.outputLines, event.line];
      },
    }),
    setQuestion: assign({
      pendingQuestion: ({ context, event }) => {
        if (event.type !== 'QUESTION') return context.pendingQuestion;

        debugLog('useAppState', 'State machine: setQuestion action called', {
          toolUseID: event.question.toolUseID,
          questionCount: event.question.questions.length,
          hasPendingQuestion: !!context.pendingQuestion,
          queueLength: context.questionQueue.length
        });

        // If there's already a pending question, this will be added to queue by queueQuestion action
        // Otherwise, show immediately
        return context.pendingQuestion || event.question;
      },
      questionQueue: ({ context, event }) => {
        if (event.type !== 'QUESTION') return context.questionQueue;

        // If there's already a pending question, add new question to queue
        if (context.pendingQuestion) {
          debugLog('useAppState', 'Adding question to queue', {
            toolUseID: event.question.toolUseID,
            newQueueLength: context.questionQueue.length + 1
          });
          return [...context.questionQueue, event.question];
        }

        // Otherwise, don't add to queue (it's being shown immediately)
        return context.questionQueue;
      },
    }),
    clearQuestion: assign({
      pendingQuestion: ({ context }) => {
        // If there are queued questions, show the next one
        if (context.questionQueue.length > 0) {
          const nextQuestion = context.questionQueue[0];
          debugLog('useAppState', 'Processing next queued question', {
            toolUseID: nextQuestion.toolUseID,
            remainingInQueue: context.questionQueue.length - 1
          });
          return nextQuestion;
        }

        debugLog('useAppState', 'No more queued questions');
        return null;
      },
      questionQueue: ({ context }) => {
        // Remove the first question from queue (it's now being shown)
        if (context.questionQueue.length > 0) {
          return context.questionQueue.slice(1);
        }
        return [];
      },
    }),
    clearOutput: assign({
      outputLines: [],
    }),
    setMode: assign({
      mode: ({ event }) => {
        if (event.type !== 'EXECUTE') return 'none';
        return event.mode;
      },
      agentSessionActive: true,
    }),
    clearMode: assign({
      mode: 'none',
      agentSessionActive: false,
    }),
    clearQuestionQueue: assign({
      pendingQuestion: null,
      questionQueue: [],
    }),
  },
}).createMachine({
  id: 'tui',
  initial: 'idle',
  context: {
    outputLines: [],
    pendingQuestion: null,
    questionQueue: [],
    workspaceRoot: process.cwd(),
    cliManager: null,
    mode: 'none',
    agentSessionActive: false,
  },
  states: {
    idle: {
      on: {
        EXECUTE: {
          target: 'executing',
          actions: 'setMode',
        },
        QUESTION: {
          target: 'waiting_for_answer',
          actions: 'setQuestion',
        },
        EXIT_MODE: {
          actions: 'clearMode',
        },
        CLEAR: {
          actions: 'clearOutput',
        },
        OUTPUT: {
          actions: 'updateOutput',
        },
      },
    },
    executing: {
      on: {
        OUTPUT: {
          actions: 'updateOutput',
        },
        QUESTION: {
          target: 'waiting_for_answer',
          actions: 'setQuestion',
        },
        COMPLETE: {
          target: 'idle',
          actions: 'clearQuestionQueue',
          // Don't clear mode - keep it active for follow-up messages
        },
        INTERRUPT: {
          target: 'idle',
          actions: ['clearMode', 'clearQuestionQueue'],
        },
        EXIT_MODE: {
          target: 'idle',
          actions: ['clearMode', 'clearQuestionQueue'],
        },
        MESSAGE: {
          // Handle in-execution messages
        },
      },
    },
    waiting_for_answer: {
      on: {
        QUESTION: {
          // When a new question arrives while already waiting, add to queue
          actions: 'setQuestion',
        },
        ANSWER: [
          {
            // Stay in waiting_for_answer if there are more queued questions
            target: 'waiting_for_answer',
            guard: ({ context }) => context.questionQueue.length > 0,
            actions: 'clearQuestion',
          },
          {
            // Otherwise return to executing
            target: 'executing',
            actions: 'clearQuestion',
          },
        ],
        COMPLETE: {
          // Execution ended while waiting for answer - clear questions and go to idle
          target: 'idle',
          actions: 'clearQuestionQueue',
        },
        INTERRUPT: {
          target: 'idle',
          actions: ['clearQuestionQueue', 'clearMode'],
        },
        EXIT_MODE: {
          target: 'idle',
          actions: ['clearQuestionQueue', 'clearMode'],
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

  // Mode state
  mode: 'none' | 'plan' | 'build';
  agentSessionActive: boolean;

  // Task/Session state
  sessions: Session[];
  tasks: Task[];
  activeSession: Session | null;
  sessionsLoading: boolean;
  tasksLoading: boolean;
  sessionsError: Error | null;
  tasksError: Error | null;

  // Actions
  executeCommand: (cmd: string) => void;
  sendMessage: (msg: string) => void;
  handleQuestionAnswer: (answers: Record<string, string>) => void;
  clearOutput: () => void;
  interrupt: () => void;
  setActiveSession: (session: Session | null) => void;
  cleanup: () => void;
}

export function useAppState(workspaceRoot: string, issueTracker?: 'linear' | 'beads' | null): AppState {
  // Use XState machine
  const [state, send] = useMachine(tuiMachine);

  // React Query client for cache invalidation
  const queryClient = useQueryClient();

  // CLI Manager and Conversation Watcher instances
  const cliManager = useRef<CliManager | null>(null);
  const conversationWatcher = useRef<ConversationWatcher | null>(null);

  // Active session tracking
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // React Query hooks for task/session data
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useSessions();

  const {
    data: tasks = [],
    isLoading: tasksLoading,
    error: tasksError,
  } = useSessionTasks(activeSession?.id ?? null);

  // Initialize CLI Manager and Conversation Watcher
  useEffect(() => {
    if (!cliManager.current) {
      cliManager.current = new CliManager();

      // Listen for output events
      cliManager.current.on('output', (line: OutputLine) => {
        debugLog('useAppState', 'Received output line', {
          type: line.type,
          text: line.text?.substring(0, 50),
        });

        // Handle question lines specially
        if (line.type === 'question' && line.question) {
          debugLog('useAppState', 'Question line detected', {
            toolUseID: line.question.toolUseID,
            questionCount: line.question.questions.length
          });
          send({ type: 'QUESTION', question: line.question });
        }

        send({ type: 'OUTPUT', line });
      });

      // Listen for completion
      cliManager.current.on('complete', ({ exitCode }: { exitCode?: number } = {}) => {
        debugLog('useAppState', 'Execution complete', { exitCode });
        send({ type: 'COMPLETE' });
      });

      // Listen for kill
      cliManager.current.on('killed', () => {
        debugLog('useAppState', 'CLI process killed');
        send({ type: 'INTERRUPT' });
      });
    }

    if (!conversationWatcher.current) {
      conversationWatcher.current = new ConversationWatcher();

      // Listen for task spawn events (for Linear refetching)
      conversationWatcher.current.on('task_spawn', (event: any) => {
        debugLog('useAppState', 'Task spawn detected via conversation watcher', {
          subagentType: event.input?.subagent_type,
        });

        // Handle build agent spawn - refetch Linear tasks
        if (event.input?.subagent_type === 'build') {
          debugLog('useAppState', 'Build agent spawned - refetch Linear tasks');
          // TODO: Trigger Linear task refetch here
          // queryClient.invalidateQueries({ queryKey: ['linear-tasks'] });
        }
      });

      // Listen for AskUserQuestion tool use
      conversationWatcher.current.on('tool_use', (event: any) => {
        if (event.name === 'AskUserQuestion') {
          debugLog('useAppState', 'AskUserQuestion detected via conversation watcher', {
            toolId: event.id,
            input: event.input,
          });

          const questionData: QuestionData = {
            toolUseID: event.id,
            questions: event.input.questions || [],
          };

          send({ type: 'QUESTION', question: questionData });
        }
      });

      // Listen for Linear tool results to capture project/issue IDs
      conversationWatcher.current.on('linear_tool_result', (event: any) => {
        debugLog('useAppState', 'Linear tool result detected', {
          toolName: event.name,
          toolId: event.id,
        });

        // Parse tool result content to extract Linear IDs
        try {
          const content = event.content;
          let parsedContent: any;

          // Content might be a string or already parsed
          if (typeof content === 'string') {
            parsedContent = JSON.parse(content);
          } else {
            parsedContent = content;
          }

          // Get current session ID from conversation watcher
          const sessionId = conversationWatcher.current?.getCurrentSessionId();
          if (!sessionId) {
            debugLog('useAppState', 'No active session ID, skipping metadata storage');
            return;
          }

          debugLog('useAppState', 'Storing Linear metadata for session', {
            sessionId,
            toolName: event.name,
          });

          // Store metadata based on tool type
          const program = Effect.gen(function* () {
            const service = yield* SessionMetadataService;

            if (event.name === 'mcp__linear__create_project') {
              // Extract project ID and identifier
              const projectId = parsedContent.project?.id || parsedContent.id;
              const projectIdentifier = parsedContent.project?.identifier || parsedContent.identifier;

              if (projectId) {
                debugLog('useAppState', 'Storing Linear project association', {
                  sessionId,
                  projectId,
                  projectIdentifier,
                });
                yield* service.setLinearProject(sessionId, projectId, projectIdentifier);

                // Trigger refetch of sessions (epics/projects)
                yield* Effect.sync(() => {
                  debugLog('useAppState', 'Invalidating sessions query after project creation');
                  queryClient.invalidateQueries({ queryKey: taskQueryKeys.sessions() });
                });
              }
            } else if (event.name === 'mcp__linear__create_issue') {
              // Extract issue ID and identifier
              const taskId = parsedContent.issue?.id || parsedContent.id;
              const taskIdentifier = parsedContent.issue?.identifier || parsedContent.identifier;

              if (taskId) {
                debugLog('useAppState', 'Storing Linear task association', {
                  sessionId,
                  taskId,
                  taskIdentifier,
                });
                yield* service.setLinearTask(sessionId, taskId, taskIdentifier);

                // Trigger refetch of tasks for this session
                yield* Effect.sync(() => {
                  debugLog('useAppState', 'Invalidating task queries after issue creation', {
                    sessionId,
                  });
                  queryClient.invalidateQueries({
                    queryKey: taskQueryKeys.sessionTasks(sessionId),
                  });
                  queryClient.invalidateQueries({ queryKey: taskQueryKeys.readyTasks() });
                });
              }
            } else if (event.name === 'mcp__linear__update_issue') {
              // Trigger refetch on issue updates
              yield* Effect.sync(() => {
                debugLog('useAppState', 'Invalidating task queries after issue update');
                queryClient.invalidateQueries({ queryKey: taskQueryKeys.all });
              });
            }
          });

          // Run the Effect program
          Effect.runPromise(
            program.pipe(Effect.provide(SessionMetadataService.Default))
          ).catch((error: any) => {
            debugLog('useAppState', 'Error storing Linear metadata', {
              error: String(error),
            });
          });
        } catch (error) {
          debugLog('useAppState', 'Error parsing Linear tool result', {
            error: String(error),
          });
        }
      });

      // Start watching for conversation files
      conversationWatcher.current.start();
    }

    // Cleanup on unmount
    return () => {
      if (cliManager.current) {
        cliManager.current.kill();
        cliManager.current.removeAllListeners();
      }
      if (conversationWatcher.current) {
        conversationWatcher.current.stop();
        conversationWatcher.current.removeAllListeners();
      }
    };
  }, [send]);

  /**
   * Execute a command (slash command or message)
   */
  const executeCommand = (cmd: string) => {
    if (!cmd.trim() || !cliManager.current) return;

    const isSlashCommand = cmd.startsWith('/');
    const inActiveMode = state.context.mode !== 'none' && state.context.agentSessionActive;

    // If in active mode and NOT a slash command, route to existing agent
    if (inActiveMode && !isSlashCommand) {
      try {
        // Send message to active agent session
        cliManager.current.sendMessageToAgent(cmd);

        // Add user message to output
        send({
          type: 'OUTPUT',
          line: {
            text: `> ${cmd}`,
            type: 'user',
          },
        });

        send({ type: 'MESSAGE', content: cmd });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addSystemMessage(`Error: Could not send message to agent. ${errorMessage}`);
      }
      return;
    }

    // Handle slash commands
    if (isSlashCommand) {
      handleSlashCommand(cmd);
      return;
    }

    // Not in a mode and not a slash command - show hint
    addSystemMessage('No process running. Use /plan or /build to start.');
  };

  /**
   * Handle slash commands
   */
  const handleSlashCommand = (cmd: string) => {
    const parts = cmd.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    switch (command) {
      case '/plan': {
        const currentMode = state.context.mode;
        const inActiveSession = state.context.agentSessionActive;

        // Check for --resume flag
        const resumeMatch = args.match(/--resume=([a-f0-9-]+)/);
        const resumeSessionId = resumeMatch ? resumeMatch[1] : undefined;
        // Remove --resume flag from args to get clean prompt
        const cleanArgs = args.replace(/--resume=[a-f0-9-]+\s*/, '').trim();

        // If resuming a session
        if (resumeSessionId) {
          addSystemMessage(`Resuming conversation: ${resumeSessionId.substring(0, 8)}...`);
          const prompt = cleanArgs || 'Continue the conversation';
          startExecution(prompt, 'plan', `> ${prompt}`, false, resumeSessionId);
          break;
        }

        // If already in plan mode and has active session, continue the conversation
        if (currentMode === 'plan' && inActiveSession && cleanArgs) {
          // Re-execute with new prompt but don't clear output
          const prompt = cleanArgs;
          startExecution(prompt, 'plan', `> ${cleanArgs}`, true); // true = continuingSession
          break;
        }

        // If in build mode, need to exit first
        if (currentMode === 'build') {
          addSystemMessage('Already in build mode. Use /exit to exit current mode first.');
          break;
        }

        // Start new plan session
        const prompt = cleanArgs || 'Create a plan for the current task';
        startExecution(prompt, 'plan', cleanArgs ? `> ${cleanArgs}` : undefined, false);
        break;
      }

      case '/build': {
        const currentMode = state.context.mode;
        const inActiveSession = state.context.agentSessionActive;

        // If already in build mode and has active session, continue the conversation
        if (currentMode === 'build' && inActiveSession && args) {
          // Re-execute with new prompt but don't clear output
          const prompt = args;
          startExecution(prompt, 'build', `> ${args}`, true); // true = continuingSession
          break;
        }

        // If in plan mode, need to exit first
        if (currentMode === 'plan') {
          addSystemMessage('Already in plan mode. Use /exit to exit current mode first.');
          break;
        }

        // Start new build session
        const prompt = args || 'Execute the plan';
        startExecution(prompt, 'build', args ? `> ${args}` : undefined, false);
        break;
      }

      case '/resume':
        // Resume command - go back to selection view where user can pick a conversation
        // In the future, could auto-resume most recent conversation if no args
        addSystemMessage('Select a conversation to resume from the list');
        // This will be handled by the app - need to add a way to go back to selection
        // For now, just show a message
        break;

      case '/exit':
        if (state.context.mode !== 'none') {
          // Kill active agent process
          cliManager.current?.kill();

          // Clear conversation history
          cliManager.current?.clear();

          // Send EXIT_MODE event
          send({ type: 'EXIT_MODE' });

          // Show confirmation
          addSystemMessage(`✓ Exited ${state.context.mode} mode`);
        } else {
          addSystemMessage('Not currently in any mode');
        }
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
  const startExecution = async (
    prompt: string,
    mode: 'plan' | 'build',
    userMessage?: string,
    continuingSession: boolean = false,
    resumeSessionId?: string
  ) => {
    if (!cliManager.current || state.matches('executing')) return;

    // Only clear output and history if starting a fresh session (and not resuming)
    if (!continuingSession && !resumeSessionId) {
      send({ type: 'CLEAR' });
      cliManager.current.clear(); // Clear conversation history
    }

    // Show user's message if provided (without the slash command)
    if (userMessage) {
      send({
        type: 'OUTPUT',
        line: {
          text: userMessage,
          type: 'user',
        },
      });
    }

    send({ type: 'EXECUTE', prompt, mode });

    // Log workspace context
    debugLog('useAppState', 'Executing with workspace context', {
      workspaceRoot,
      mode,
      promptLength: prompt.length,
    });

    // Build system prompt using PromptService (single source of truth)
    const previousContext = continuingSession && cliManager.current
      ? cliManager.current.getConversationContext()
      : undefined;

    const buildConfig: BuildConfig = {
      workspaceRoot,
      mode,
      issueTracker,
      previousContext,
    };

    // Use Effect to build the prompt
    const promptProgram = Effect.gen(function* () {
      const promptService = yield* PromptService;
      return yield* promptService.buildPrompt(buildConfig);
    });

    const systemPrompt = await Runtime.runPromise(
      Runtime.defaultRuntime
    )(
      promptProgram.pipe(
        Effect.provide(PromptServiceLive)
      )
    ).catch((error: Error) => {
      throw new Error(`Failed to build prompt: ${error.message}`);
    });

    // Load historical conversation if resuming
    if (resumeSessionId) {
      try {
        const historyProgram = Effect.gen(function* () {
          const conversationService = yield* ConversationService;
          const historyConverter = yield* HistoryConverter;

          const events = yield* conversationService.getConversationDetails(
            resumeSessionId,
            workspaceRoot
          );
          const historyLines = yield* historyConverter.convertToOutputLines(events);

          const separator = historyConverter.createHistorySeparator();
          const resumeSeparator = historyConverter.createResumeSeparator();

          return [separator, ...historyLines, resumeSeparator];
        });

        const historyLines = await Effect.runPromise(
          historyProgram.pipe(
            Effect.provide(ConversationService.Default),
            Effect.provide(HistoryConverter.Default)
          )
        );

        for (const line of historyLines) {
          send({ type: 'OUTPUT', line });
        }
      } catch (_error) {
        // Show warning but continue with resume
        send({
          type: 'OUTPUT',
          line: {
            text: `Warning: Could not load conversation history.`,
            type: 'system',
          },
        });
      }
    }

    // Execute via CLI Manager
    // Use Opus for planning (comprehensive research), Sonnet for building (faster execution)
    const selectedModel = mode === 'plan' ? 'opus' : 'sonnet';

    cliManager.current.execute(prompt, {
      workspaceRoot,
      model: selectedModel,
      systemPrompt,
      mode,
      resumeSessionId,
    }).catch((error: Error) => {
      addSystemMessage(`Execution error: ${error.message}`);
      send({ type: 'COMPLETE' });
    });
  };

  /**
   * Send a message to the running CLI
   */
  const sendMessage = (msg: string) => {
    if (!cliManager.current || !state.matches('executing')) return;
    cliManager.current.sendMessageToAgent(msg);
    send({ type: 'MESSAGE', content: msg });
  };

  /**
   * Handle question answer
   */
  const handleQuestionAnswer = (answers: Record<string, string>) => {
    debugLog('useAppState', 'handleQuestionAnswer called', { answers });

    if (!cliManager.current || !state.context.pendingQuestion) {
      debugLog('useAppState', 'ERROR: Cannot handle answer - missing cliManager or pendingQuestion', {
        hasCliManager: !!cliManager.current,
        hasPendingQuestion: !!state.context.pendingQuestion
      });
      console.error('[useAppState] Cannot handle answer - missing cliManager or pendingQuestion');
      return;
    }

    debugLog('useAppState', 'Pending question toolUseID', {
      toolUseID: state.context.pendingQuestion.toolUseID
    });

    // Send tool result back to CLI
    // AskUserQuestion expects answers as a flat object: { "question text": "answer" }
    const answersJSON = JSON.stringify(answers);
    debugLog('useAppState', 'Sending answers JSON', { answersJSON });

    cliManager.current.sendToolResult(state.context.pendingQuestion.toolUseID, answersJSON);

    debugLog('useAppState', 'Sending ANSWER event to state machine');
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

    // Mode state
    mode: state.context.mode,
    agentSessionActive: state.context.agentSessionActive,

    // Task/Session state
    sessions,
    tasks,
    activeSession,
    sessionsLoading,
    tasksLoading,
    sessionsError: sessionsError || null,
    tasksError: tasksError || null,

    // Actions
    executeCommand,
    sendMessage,
    handleQuestionAnswer,
    clearOutput,
    interrupt,
    setActiveSession,

    // Cleanup function for graceful exit
    cleanup: () => {
      if (cliManager.current) {
        cliManager.current.kill();
      }
    },
  };
}
