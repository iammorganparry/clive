/**
 * CliManager
 * Central orchestrator for Claude CLI execution with event enrichment
 *
 * Responsibilities:
 * - Manages ClaudeCliService lifecycle
 * - Enriches events with metadata (duration, cost, diffs, subagent info)
 * - Coordinates DiffDetector, SubagentTracker, MetadataCalculator
 * - Emits enriched OutputLine events
 */

import { EventEmitter } from 'events';
import { Effect, Runtime, Stream } from 'effect';
import {
  ClaudeCliService,
  type ClaudeCliEvent,
  type CliExecutionHandle,
  ClaudeCliExecutionError,
} from '@clive/claude-services';
import type { OutputLine, QuestionData } from '../types';
import { DiffDetector } from './DiffDetector';
import { SubagentTracker } from './SubagentTracker';
import { MetadataCalculator } from './MetadataCalculator';
import { ConversationLogger } from './ConversationLogger';
import { debugLog } from '../utils/debug-logger';

export interface CliManagerOptions {
  workspaceRoot: string;
  model?: string;
  systemPrompt?: string;
  mode?: 'plan' | 'build';
  resumeSessionId?: string;
}

export class CliManager extends EventEmitter {
  private runtime: Runtime.Runtime<ClaudeCliService>;
  private currentHandle: CliExecutionHandle | null = null;
  private diffDetector = new DiffDetector();
  private subagentTracker = new SubagentTracker();
  private conversationLogger = new ConversationLogger();

  // Track tool metadata for enrichment
  private toolTimings = new Map<string, Date>();
  private toolNames = new Map<string, string>();
  private toolInputs = new Map<string, any>();

  // Track active agent session for persistent modes
  private activeMode: 'plan' | 'build' | null = null;

  // Track pending question to keep handle alive
  private pendingQuestionId: string | null = null;

  // Track all question IDs from current turn
  private currentTurnQuestionIds = new Set<string>();

  // Track which tool results have already been sent to prevent duplicates
  private sentToolResults = new Set<string>();

  // Track if we've already sent a tool_result this turn (only ONE per turn to prevent 400 errors)
  private hasAnsweredQuestionThisTurn = false;

  // Track conversation history for continuous sessions
  private conversationHistory: Array<{ role: 'user' | 'assistant', content: string }> = [];

  constructor() {
    super();

    // Create Effect runtime with ClaudeCliService
    const layer = ClaudeCliService.Default;
    this.runtime = Effect.runSync(
      Effect.gen(function* () {
        return yield* Effect.runtime<ClaudeCliService>();
      }).pipe(Effect.provide(layer))
    );
  }

  /**
   * Execute a prompt via Claude CLI with enrichment
   */
  async execute(prompt: string, options: CliManagerOptions, appendToHistory: boolean = false): Promise<void> {
    debugLog('CliManager', 'Starting execution', {
      promptLength: prompt.length,
      model: options.model,
      mode: options.mode,
      workspaceRoot: options.workspaceRoot,
      appendToHistory,
      historyLength: this.conversationHistory.length
    });

    // Start conversation logging if mode is set
    if (options.mode) {
      this.conversationLogger.start(options.workspaceRoot, options.mode);
      debugLog('CliManager', 'Started conversation logging', {
        logFile: this.conversationLogger.getLogFile()
      });
    }

    // Add user message to history if not already there
    if (appendToHistory || this.conversationHistory.length === 0) {
      this.conversationHistory.push({ role: 'user', content: prompt });
    }

    const program = Effect.gen(this.createExecutionProgram(prompt, options));

    try {
      await Effect.runPromise(program.pipe(Effect.provide(ClaudeCliService.Default)));
      debugLog('CliManager', 'Execution completed successfully');
    } catch (error) {
      debugLog('CliManager', 'Execution error', { error: String(error) });
      this.emit('output', {
        text: `Execution error: ${error}`,
        type: 'stderr',
      } as OutputLine);
    } finally {
      // Stop conversation logging
      this.conversationLogger.stop();
      debugLog('CliManager', 'Stopped conversation logging');
    }
  }

  /**
   * Create the execution program
   */
  private createExecutionProgram(prompt: string, options: CliManagerOptions) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      // Spawn CLI process
      const handle = yield* cliService.execute({
        prompt,
        systemPrompt: options.systemPrompt,
        workspaceRoot: options.workspaceRoot,
        model: options.model || 'sonnet',
        resumeSessionId: options.resumeSessionId,
      });

      self.currentHandle = handle;
      self.activeMode = options.mode || null;

      // Stream events with enrichment
      yield* handle.stream.pipe(
        Stream.runForEach((event) => Effect.sync(() => {
          const enrichedLines = self.enrichEvent(event);

          debugLog('CliManager', 'Emitting enriched lines', {
            count: enrichedLines.length,
            types: enrichedLines.map(l => l.type)
          });

          // Log enriched output lines
          for (const line of enrichedLines) {
            self.conversationLogger.log({
              timestamp: new Date().toISOString(),
              type: 'enriched_output',
              line,
            });
          }

          // Emit all enriched lines
          for (const line of enrichedLines) {
            debugLog('CliManager', 'Emitting output event', {
              type: line.type,
              hasQuestion: !!(line.type === 'question' && line.question)
            });
            self.emit('output', line);
          }
        }))
      );

      // Execution complete
      // Keep handle alive if:
      // 1. In persistent modes (plan/build)
      // 2. There's a pending question waiting for user response
      if (!self.activeMode && !self.pendingQuestionId) {
        self.currentHandle = null;
      }
      self.emit('complete');
    };
  }

  /**
   * Enrich ClaudeCliEvent with metadata and context
   * Returns array of OutputLines (may be multiple for one event)
   */
  private enrichEvent(event: ClaudeCliEvent): OutputLine[] {
    const outputs: OutputLine[] = [];

    debugLog('CliManager', 'enrichEvent called', { eventType: event.type });

    // Log raw event to conversation log
    this.conversationLogger.log({
      timestamp: new Date().toISOString(),
      type: 'raw_event',
      event,
    });

    switch (event.type) {
      case 'tool_use': {
        // Track tool metadata
        this.toolTimings.set(event.id, new Date());
        this.toolNames.set(event.id, event.name);
        this.toolInputs.set(event.id, event.input);

        // Check for special tool types
        if (event.name === 'AskUserQuestion') {
          // Handle question - emit question event
          debugLog('CliManager', 'AskUserQuestion tool detected', {
            toolId: event.id,
            input: event.input
          });

          // Track this question as part of current turn
          this.currentTurnQuestionIds.add(event.id);
          debugLog('CliManager', 'Added question to current turn', {
            toolId: event.id,
            currentTurnQuestions: Array.from(this.currentTurnQuestionIds)
          });

          // Track pending question to keep CLI handle alive
          this.pendingQuestionId = event.id;
          debugLog('CliManager', 'Set pendingQuestionId', { pendingQuestionId: this.pendingQuestionId });

          const questionData = this.extractQuestionData(event.id, event.input);

          debugLog('CliManager', 'Question data extracted', {
            toolUseID: questionData.toolUseID,
            questionCount: questionData.questions.length
          });

          outputs.push({
            text: '',
            type: 'question',
            toolUseID: event.id,
            question: questionData,
          });

          debugLog('CliManager', 'Question event pushed to outputs');
          return outputs;
        }

        // Capture file state for diffs
        this.diffDetector.handleToolUse(event.name, event.input);

        // Check for subagent spawn
        const spawnEvent = this.subagentTracker.handleToolUse(
          event.id,
          event.name,
          event.input
        );
        if (spawnEvent) {
          outputs.push(spawnEvent);
        }

        // Regular tool call
        outputs.push({
          text: `● ${event.name}`,
          type: 'tool_call',
          toolName: event.name,
          toolUseID: event.id,
          toolInput: event.input,
          startTime: new Date(),
        });

        break;
      }

      case 'tool_result': {
        const toolName = this.toolNames.get(event.id) || 'unknown';
        const toolInput = this.toolInputs.get(event.id);

        // Calculate duration
        const startTime = this.toolTimings.get(event.id);
        const duration = startTime ? Date.now() - startTime.getTime() : undefined;

        // Generate file diff if applicable
        const diff = this.diffDetector.generateDiff(toolName, toolInput);
        if (diff) {
          outputs.push({
            text: diff,
            type: 'file_diff',
            toolUseID: event.id,
          });
        }

        // Check for subagent completion
        const completeEvent = this.subagentTracker.handleToolResult(
          event.id,
          toolName,
          event.content
        );
        if (completeEvent) {
          outputs.push(completeEvent);
        }

        // Extract metadata from result (if available)
        const metadata = this.extractResultMetadata(event.content);

        // Main tool result
        outputs.push({
          text: event.content,
          type: 'tool_result',
          toolUseID: event.id,
          toolName,
          duration,
          ...metadata,
        });

        // Cleanup
        this.toolTimings.delete(event.id);
        this.toolNames.delete(event.id);
        this.toolInputs.delete(event.id);

        break;
      }

      case 'text': {
        outputs.push({
          text: event.content,
          type: 'assistant',
        });

        // Track assistant response in conversation history
        const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
        if (!lastMessage || lastMessage.role !== 'assistant') {
          // Start new assistant message
          this.conversationHistory.push({ role: 'assistant', content: event.content });
        } else {
          // Append to existing assistant message
          lastMessage.content += event.content;
        }

        break;
      }

      case 'thinking': {
        outputs.push({
          text: event.content,
          type: 'system',
        });
        break;
      }

      case 'error': {
        outputs.push({
          text: event.message,
          type: 'stderr',
        });
        break;
      }

      case 'done': {
        // Clear current turn questions - any answers sent after this are invalid
        if (this.currentTurnQuestionIds.size > 0) {
          debugLog('CliManager', 'Turn ended with unanswered questions - clearing', {
            questionIds: Array.from(this.currentTurnQuestionIds)
          });
          this.currentTurnQuestionIds.clear();

          // Clear pending question to unblock UI
          this.pendingQuestionId = null;
        }

        // Reset turn flag - allow answering questions in next turn
        this.hasAnsweredQuestionThisTurn = false;
        debugLog('CliManager', 'Turn ended - reset question answer flag');

        outputs.push({
          text: '',
          type: 'exit',
          exitCode: 0,
        });
        break;
      }
    }

    return outputs;
  }

  /**
   * Extract question data from AskUserQuestion tool input
   */
  private extractQuestionData(toolUseID: string, input: any): QuestionData {
    return {
      toolUseID,
      questions: input.questions || [],
    };
  }

  /**
   * Extract metadata from tool result content
   * TODO: CLI should provide this in structured format
   */
  private extractResultMetadata(content: string): Partial<OutputLine> {
    // For now, return empty metadata
    // In the future, CLI can include token/cost data in JSON format
    return {};
  }

  /**
   * Send a tool result back to the CLI via stdin
   */
  sendToolResult(toolId: string, result: string): void {
    debugLog('CliManager', 'sendToolResult called', { toolId, resultLength: result.length });

    if (!this.currentHandle) {
      debugLog('CliManager', 'ERROR: Cannot send tool result - no active handle');
      console.error('[CliManager] Cannot send tool result - no active handle');
      return;
    }

    // CRITICAL: Only allow ONE tool_result per turn to prevent Claude CLI replay bug
    // When Claude calls AskUserQuestion multiple times, only answer the FIRST one
    // Answering multiple questions causes the last tool_result to be replayed in subsequent requests
    if (this.hasAnsweredQuestionThisTurn) {
      debugLog('CliManager', 'WARNING: Already answered question this turn - ignoring to prevent 400 error', {
        toolId,
        reason: 'Only one tool_result allowed per turn'
      });

      // Log to conversation log
      this.conversationLogger.log({
        timestamp: new Date().toISOString(),
        type: 'tool_result_blocked',
        toolId,
        result,
        reason: 'Already answered question this turn (only one per turn allowed)',
      });

      return;
    }

    // Check if this tool result has already been sent (prevent duplicates)
    if (this.sentToolResults.has(toolId)) {
      debugLog('CliManager', 'WARNING: Tool result already sent - ignoring duplicate', {
        toolId,
        alreadySent: Array.from(this.sentToolResults)
      });

      // Log to conversation log
      this.conversationLogger.log({
        timestamp: new Date().toISOString(),
        type: 'tool_result_duplicate',
        toolId,
        result,
        reason: 'Already sent',
      });

      return;
    }

    debugLog('CliManager', 'Sending tool result to handle', {
      toolId,
      resultPreview: result.substring(0, 200),
      currentPendingQuestionId: this.pendingQuestionId
    });

    // Log tool result being sent
    this.conversationLogger.log({
      timestamp: new Date().toISOString(),
      type: 'tool_result_sent',
      toolId,
      result,
    });

    this.currentHandle.sendToolResult(toolId, result);

    // Mark that we've answered a question this turn
    this.hasAnsweredQuestionThisTurn = true;
    debugLog('CliManager', 'Set hasAnsweredQuestionThisTurn = true');

    // Mark this tool result as sent
    this.sentToolResults.add(toolId);

    // Remove this question from current turn set
    this.currentTurnQuestionIds.delete(toolId);
    debugLog('CliManager', 'Removed question from current turn', {
      toolId,
      remainingQuestions: Array.from(this.currentTurnQuestionIds)
    });

    // Clear pending question ID if this was the tracked question
    if (this.pendingQuestionId === toolId) {
      debugLog('CliManager', 'Clearing pendingQuestionId', { toolId });
      this.pendingQuestionId = null;
    }

    debugLog('CliManager', 'Tool result sent successfully', { toolId });
  }

  /**
   * Send a message to the CLI
   */
  sendMessage(message: string): void {
    if (!this.currentHandle) {
      console.error('[CliManager] Cannot send message - no active handle');
      return;
    }

    // For bidirectional mode, messages are sent as tool results
    // or via stdin depending on the CLI mode
    console.log('[CliManager] sendMessage not yet implemented:', message);
  }

  /**
   * Send a message to the active agent session
   * Used in persistent plan/build modes for follow-up messages
   *
   * NOTE: This currently just returns the conversation history context.
   * The actual re-execution is handled by the caller which will pass
   * this context to execute(). This is a workaround until the CLI
   * supports proper bidirectional chat mode.
   *
   * TODO: Implement proper chat mode when Claude CLI supports it
   */
  getConversationContext(): string {
    if (this.conversationHistory.length === 0) {
      return '';
    }

    const historyContext = this.conversationHistory
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    return `\n\nPREVIOUS CONVERSATION:\n${historyContext}\n\nContinue the conversation with context from above.`;
  }

  /**
   * Simplified sendMessageToAgent - just marks that we're continuing a conversation
   */
  async sendMessageToAgent(message: string): Promise<void> {
    if (!this.hasActiveSession()) {
      throw new Error('No active agent session');
    }

    // Add message to history
    this.conversationHistory.push({ role: 'user', content: message });

    debugLog('CliManager', 'Message added to conversation history', {
      message: message.substring(0, 100),
      historyLength: this.conversationHistory.length
    });
  }

  /**
   * Check if there's an active agent session
   */
  hasActiveSession(): boolean {
    return !!(this.currentHandle && this.activeMode);
  }

  /**
   * Get the current active mode
   */
  getActiveMode(): 'plan' | 'build' | null {
    return this.hasActiveSession() ? this.activeMode : null;
  }

  /**
   * Kill the running CLI process
   */
  kill(): void {
    if (this.currentHandle) {
      this.currentHandle.kill();
      this.currentHandle = null;
      this.activeMode = null;
      this.pendingQuestionId = null;
      this.emit('killed');
    }
  }

  /**
   * Interrupt the CLI process (Ctrl+C)
   */
  interrupt(): void {
    this.kill(); // For now, same as kill
  }

  /**
   * Clear all tracked state (useful when starting new session)
   */
  clear(): void {
    this.toolTimings.clear();
    this.toolNames.clear();
    this.toolInputs.clear();
    this.diffDetector.clear();
    this.subagentTracker.clear();
    this.conversationHistory = [];
    this.pendingQuestionId = null;
    this.currentTurnQuestionIds.clear();
    this.sentToolResults.clear();
    this.hasAnsweredQuestionThisTurn = false;
  }

  /**
   * Get active subagents
   */
  getActiveSubagents() {
    return this.subagentTracker.getActiveSubagents();
  }
}
