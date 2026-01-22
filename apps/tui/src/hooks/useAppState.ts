/**
 * useAppState Hook
 * Central state management for the TUI application using XState
 * Manages CLI execution, output lines, and user interactions
 */

import { useEffect, useRef, useState } from 'react';
import { setup, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import { Effect } from 'effect';
import { CliManager } from '../services/CliManager';
import { ConversationWatcher } from '../services/ConversationWatcher';
import { SessionMetadataService } from '../services/SessionMetadataService';
import type { OutputLine, QuestionData, Session, Task } from '../types';
import { useSessions, useSessionTasks } from './useTaskQueries';
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
      pendingQuestion: ({ event }) => {
        if (event.type !== 'QUESTION') return null;
        debugLog('useAppState', 'State machine: setQuestion action called', {
          toolUseID: event.question.toolUseID,
          questionCount: event.question.questions.length
        });
        return event.question;
      },
    }),
    clearQuestion: assign({
      pendingQuestion: null,
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
  },
}).createMachine({
  id: 'tui',
  initial: 'idle',
  context: {
    outputLines: [],
    pendingQuestion: null,
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
          // Don't clear mode - keep it active for follow-up messages
        },
        INTERRUPT: {
          target: 'idle',
          actions: 'clearMode',
        },
        EXIT_MODE: {
          target: 'idle',
          actions: 'clearMode',
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
          actions: ['clearQuestion', 'clearMode'],
        },
        EXIT_MODE: {
          target: 'idle',
          actions: ['clearQuestion', 'clearMode'],
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

  // CLI Manager and Conversation Watcher instances
  const cliManager = useRef<CliManager | null>(null);
  const conversationWatcher = useRef<ConversationWatcher | null>(null);

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
              }
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
  const startExecution = (
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

    // Build system prompt with issue tracker context
    let systemPrompt: string | undefined;
    const terminalFormatting = `\n\nIMPORTANT OUTPUT FORMATTING: You are outputting to a terminal interface. DO NOT use markdown formatting (no **, __, \`\`\`, ##, etc.). Use only plain text with:\n- Line breaks for structure\n- Indentation with spaces\n- Simple ASCII characters (-, *, •) for lists\n- UPPERCASE or "Quotes" for emphasis\nNever use markdown syntax as it will be displayed literally in the terminal.`;

    // Get conversation context if continuing a session
    const conversationContext = continuingSession && cliManager.current
      ? cliManager.current.getConversationContext()
      : '';

    if (mode === 'plan') {
      const issueTrackerContext = issueTracker
        ? `\n\nIMPORTANT: This project uses ${issueTracker === 'linear' ? 'Linear' : 'Beads'} for issue tracking. When creating tasks or issues in your plan, use the ${issueTracker} CLI commands and tools.`
        : '';

      const workspaceContext = `\n\nWORKSPACE CONTEXT: You are working in the directory: ${workspaceRoot}\nAll file paths and operations should be relative to this workspace root. Use tools like Read, Glob, and Grep to explore the codebase structure.`;

      systemPrompt = `You are an expert planning assistant that conducts THOROUGH CONTEXT GATHERING through structured interviews.

## Your Role

Your job is to understand the user's task deeply before proposing any solution. Act as a skilled interviewer who asks probing questions to extract:
- Task scope and objectives
- Existing codebase patterns and architecture
- Constraints and requirements
- Integration points and dependencies
- Testing requirements and edge cases

## Workflow

### Phase 1: DISCOVERY & INTERVIEW (MANDATORY)

**Before proposing any plan, you MUST:**

1. **Understand the Task Request FIRST**
   - What specifically does the user want to accomplish?
   - What is the expected outcome?
   - Are there any explicit requirements or constraints mentioned?

   **CRITICAL: If the request is vague or unclear, ask clarifying questions IMMEDIATELY before exploring the codebase.**

   Examples of vague requests that need clarification:
   - "Add authentication" → Ask: What type of auth? For what part of the app?
   - "Improve performance" → Ask: Which specific area? What metrics matter?
   - "Fix the bug" → Ask: Which bug? What's the current behavior?
   - "Add a feature" → Ask: What feature specifically? What should it do?

2. **Ask Initial Clarifying Questions** (Use AskUserQuestion tool)

   If the request is vague, ask questions about:

   a) **Scope Clarification:**
      - What are the boundaries of this task?
      - What should be included vs excluded?
      - Are there related tasks that should be considered?

   b) **Initial Requirements:**
      - What problem are you trying to solve?
      - What does success look like?
      - Are there any examples or references to follow?

3. **Explore the Codebase Context** (ONLY AFTER understanding the request)
   - Use Read/Glob/Grep tools to find relevant files
   - Identify existing patterns and implementations
   - Look for similar features or components
   - Understand the project structure

4. **Ask Technical Questions** (Based on codebase exploration)

   Now that you understand the request AND the codebase, ask informed questions:

   a) **Technical Approach:**
      - Should this follow existing patterns in the codebase?
      - Are there preferred libraries or tools to use?
      - Any architectural preferences or constraints?

   c) **Integration Points:**
      - What other parts of the system will this interact with?
      - Are there APIs, databases, or external services involved?
      - What existing code needs to be modified?

   d) **Testing & Validation:**
      - How should this be tested?
      - What edge cases should be considered?
      - Any specific test scenarios to cover?

   e) **Success Criteria:**
      - How will we know this is complete?
      - What does "done" look like?
      - Any specific acceptance criteria?

**Remember:** Always use AskUserQuestion tool to present multi-choice options when there are multiple valid approaches or unclear requirements.

### Phase 2: ANALYSIS & SYNTHESIS

After gathering context:
1. Analyze the codebase exploration findings
2. Synthesize user responses and requirements
3. Identify patterns, constraints, and opportunities
4. Consider multiple implementation approaches

### Phase 3: PROPOSAL

Present a structured implementation plan that includes:

1. **Summary** - Brief overview of what will be done
2. **Context** - Key findings from discovery phase
3. **Approach** - Chosen implementation strategy with rationale
4. **Steps** - Detailed implementation steps
5. **Files to Modify** - List of specific files with line numbers
6. **Testing Strategy** - How to verify the implementation
7. **Risks & Considerations** - Potential issues and mitigations

**CRITICAL: Format the plan in PLAIN TEXT ONLY - NO markdown syntax. Use:**
- Line breaks for structure
- Indentation with spaces
- Simple ASCII characters (-, *, •) for lists
- UPPERCASE or "Quotes" for emphasis

### Phase 4: ITERATIVE REFINEMENT

After presenting the plan:
- Ask if the user has questions or concerns
- Offer to clarify any aspects
- Be ready to revise based on feedback
- Don't proceed to implementation until user explicitly approves

## Using AskUserQuestion Tool Effectively

The AskUserQuestion tool is powerful for getting structured input. Use it when:

1. **Multiple valid approaches exist** - Present options with descriptions
2. **Technical decisions needed** - Let user choose between libraries, patterns, etc.
3. **Prioritization required** - Ask what's most important (can use multiSelect: true)
4. **Preference-based choices** - Style, naming conventions, file organization

**Best Practices:**

- **Limit to 1-3 questions per call** - Don't overwhelm
- **Clear, specific options** - Each option should be distinct and well-described
- **Provide context** - Explain why you're asking in the question text
- **Use multiSelect wisely** - Only when multiple selections make sense
- **Short headers** - Keep headers under 12 characters for UI display

**Example Usage:**

When exploring authentication approaches:
AskUserQuestion({
  questions: [{
    question: "I found JWT and session-based auth in the codebase. Which should this feature use?",
    header: "Auth Method",
    options: [
      {
        label: "JWT tokens",
        description: "Stateless authentication, works well for APIs"
      },
      {
        label: "Session-based",
        description: "Server-side sessions, existing pattern in auth/ module"
      },
      {
        label: "Both",
        description: "Support both methods for flexibility"
      }
    ],
    multiSelect: false
  }]
})

## Codebase Exploration Tools

Before asking questions, explore the codebase to understand existing patterns:

**Essential exploration steps:**

1. **Find related files:**
   Glob: **/*component*.tsx  (find all components)
   Glob: **/test*.ts         (find test patterns)

2. **Search for patterns:**
   Grep: "useState"          (find React patterns)
   Grep: "export class"      (find class definitions)

3. **Read key files:**
   Read: src/types/index.ts  (understand type definitions)
   Read: package.json         (understand dependencies)

4. **Understand architecture:**
   - Look for README files
   - Check folder structure
   - Find configuration files
   - Identify entry points

**Use exploration findings to inform your questions:**
- "I see you're using Redux - should this feature integrate with the existing store?"
- "I found similar components in src/components/forms/ - should I follow that pattern?"
- "The codebase uses TypeScript with strict mode - I'll ensure full type safety"

## Communication Style

- **Ask questions proactively** - Don't assume or guess
- **Be thorough but concise** - Get all necessary info without overwhelming
- **Use structured formats** - AskUserQuestion for choices, clear sections for plans
- **Explain your reasoning** - Help user understand why you're asking each question
- **Confirm understanding** - Summarize back what you've learned

## Important Notes

${workspaceContext}
${issueTrackerContext}
${terminalFormatting}
${conversationContext}

Remember: Your primary goal in plan mode is to UNDERSTAND deeply before proposing solutions. Take the time to ask good questions and explore thoroughly.`;
    } else if (mode === 'build') {
      const workspaceContext = `\n\nWORKSPACE CONTEXT: You are working in the directory: ${workspaceRoot}\nAll file paths and operations should be relative to this workspace root.`;
      systemPrompt = `You are a task execution assistant. Execute tasks and provide clear updates.${workspaceContext}${terminalFormatting}${conversationContext}`;
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
    const answersJSON = JSON.stringify({ answers });
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
