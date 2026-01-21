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
  ClaudeCliEvent,
  CliExecutionHandle,
  ClaudeCliExecutionError,
} from '@clive/claude-services';
import { OutputLine, QuestionData } from '../types';
import { DiffDetector } from './DiffDetector';
import { SubagentTracker } from './SubagentTracker';
import { MetadataCalculator } from './MetadataCalculator';

export interface CliManagerOptions {
  workspaceRoot: string;
  model?: string;
  systemPrompt?: string;
}

export class CliManager extends EventEmitter {
  private runtime: Runtime.Runtime<ClaudeCliService>;
  private currentHandle: CliExecutionHandle | null = null;
  private diffDetector = new DiffDetector();
  private subagentTracker = new SubagentTracker();

  // Track tool metadata for enrichment
  private toolTimings = new Map<string, Date>();
  private toolNames = new Map<string, string>();
  private toolInputs = new Map<string, any>();

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
  async execute(prompt: string, options: CliManagerOptions): Promise<void> {
    const program = Effect.gen(this.createExecutionProgram(prompt, options));

    try {
      await Effect.runPromise(program.pipe(Effect.provide(ClaudeCliService.Default)));
    } catch (error) {
      this.emit('output', {
        text: `Execution error: ${error}`,
        type: 'error',
      } as OutputLine);
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
      });

      self.currentHandle = handle;

      // Stream events with enrichment
      yield* handle.stream.pipe(
        Stream.runForEach((event) => Effect.sync(() => {
          const enrichedLines = self.enrichEvent(event);

          // Emit all enriched lines
          for (const line of enrichedLines) {
            self.emit('output', line);
          }
        }))
      );

      // Execution complete
      self.currentHandle = null;
      self.emit('complete');
    };
  }

  /**
   * Enrich ClaudeCliEvent with metadata and context
   * Returns array of OutputLines (may be multiple for one event)
   */
  private enrichEvent(event: ClaudeCliEvent): OutputLine[] {
    const outputs: OutputLine[] = [];

    switch (event.type) {
      case 'tool_use': {
        // Track tool metadata
        this.toolTimings.set(event.id, new Date());
        this.toolNames.set(event.id, event.name);
        this.toolInputs.set(event.id, event.input);

        // Check for special tool types
        if (event.name === 'AskUserQuestion') {
          // Handle question - emit question event
          const questionData = this.extractQuestionData(event.id, event.input);
          outputs.push({
            text: '',
            type: 'question',
            toolUseID: event.id,
            question: questionData,
          });
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
    if (!this.currentHandle) {
      console.error('[CliManager] Cannot send tool result - no active handle');
      return;
    }

    this.currentHandle.sendToolResult(toolId, result);
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
   * Kill the running CLI process
   */
  kill(): void {
    if (this.currentHandle) {
      this.currentHandle.kill();
      this.currentHandle = null;
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
  }

  /**
   * Get active subagents
   */
  getActiveSubagents() {
    return this.subagentTracker.getActiveSubagents();
  }
}
