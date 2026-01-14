import { QueryClientProvider } from "@tanstack/react-query";
import { Box, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  executeCommand,
  sendApprovalResponse,
  sendQuestionAnswer,
  sendUserMessage,
  setEventHandler,
  setRefreshCallback,
} from "./commands/index.js";
import { CommandInput } from "./components/CommandInput.js";
import { Header } from "./components/Header.js";
import { HelpOverlay } from "./components/HelpOverlay.js";
import { StatusBar } from "./components/StatusBar.js";
import { TabBar } from "./components/TabBar.js";
import { TaskSidebar } from "./components/TaskSidebar.js";
import { TerminalOutput } from "./components/TerminalOutput.js";
import { useKeyboard } from "./hooks/useKeyboard.js";
import { useSessions } from "./hooks/useSessions.js";
import { useTasks } from "./hooks/useTasks.js";
import {
  OutputMachineProvider,
  useInteractionActions,
  useOutputActions,
  useRunningState,
} from "./machines/OutputMachineProvider.js";
import { queryClient, RpcProvider } from "./rpc/hooks.js";
import type { CommandContext } from "./types.js";

// Inner component that uses the machine hooks
const AppContent: React.FC = () => {
  const { stdout } = useStdout();
  const [showHelp, setShowHelp] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const inputRef = useRef<{ focus: () => void }>(null);

  // Get terminal dimensions directly - update on resize
  const width = stdout?.columns ?? 80;
  const height = stdout?.rows ?? 24;

  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    refresh: refreshSessions,
  } = useSessions();

  // Get output actions from machine - does NOT subscribe to lines
  const { appendOutput, appendSystemMessage, setIsRunning, clear } =
    useOutputActions();

  // Get running state separately
  const { isRunning } = useRunningState();

  // Get interaction actions for dispatching question/approval events
  const { sendQuestion, sendApprovalRequest, resolveInteraction } =
    useInteractionActions();

  // Tasks from React Query - auto-polls when running
  const { tasks, refresh: refreshTasks } = useTasks(activeSession, isRunning);

  // Set up event handler to dispatch Claude events to output machine
  useEffect(() => {
    setEventHandler((event) => {
      if (event.type === "question") {
        sendQuestion(event.id, event.questions);
      } else if (event.type === "approval_requested") {
        sendApprovalRequest(event.id, event.toolName, event.args);
      }
    });

    // Clean up on unmount
    return () => {
      setEventHandler(() => {});
    };
  }, [sendQuestion, sendApprovalRequest]);

  // Set up refresh callback for beads command detection
  useEffect(() => {
    setRefreshCallback(() => {
      refreshTasks();
      refreshSessions();
    });

    return () => {
      setRefreshCallback(() => {});
    };
  }, [refreshTasks, refreshSessions]);

  // Memoize command context
  const commandContext = useMemo<CommandContext>(
    () => ({
      appendOutput,
      clearOutput: clear,
      setActiveSession: setActiveSessionId,
      refreshSessions,
      refreshTasks,
      activeSession,
      setIsRunning,
    }),
    [
      appendOutput,
      clear,
      setActiveSessionId,
      refreshSessions,
      refreshTasks,
      activeSession,
      setIsRunning,
    ],
  );

  const handleCommand = useCallback(
    (input: string) => {
      // When agent is running and input is not a command, send as guidance
      if (isRunning && !input.startsWith("/")) {
        // Show the user's message in output
        appendOutput(input, "user_input");
        // Send to active agent
        sendUserMessage(input);
      } else {
        // Normal command execution - auto-add "/" if missing
        const command = input.startsWith("/") ? input : `/${input}`;
        appendSystemMessage(`> ${command}`);
        executeCommand(command, commandContext);
      }
    },
    [appendOutput, appendSystemMessage, commandContext, isRunning],
  );

  // Handlers for interactive prompts
  const handleQuestionAnswer = useCallback(
    (toolCallId: string, answers: Record<string, string>) => {
      sendQuestionAnswer(toolCallId, answers);
      resolveInteraction(); // Clear the pending interaction from UI
    },
    [resolveInteraction],
  );

  const handleApprovalResponse = useCallback(
    (toolCallId: string, approved: boolean) => {
      sendApprovalResponse(toolCallId, approved);
      resolveInteraction(); // Clear the pending interaction from UI
    },
    [resolveInteraction],
  );

  // Tab navigation helpers
  const prevTab = useCallback(() => {
    if (sessions.length > 0) {
      const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
      const newIndex =
        currentIndex > 0 ? currentIndex - 1 : sessions.length - 1;
      setActiveSessionId(sessions[newIndex].id);
    }
  }, [sessions, activeSessionId, setActiveSessionId]);

  const nextTab = useCallback(() => {
    if (sessions.length > 0) {
      const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
      const newIndex =
        currentIndex < sessions.length - 1 ? currentIndex + 1 : 0;
      setActiveSessionId(sessions[newIndex].id);
    }
  }, [sessions, activeSessionId, setActiveSessionId]);

  // Global keyboard shortcuts
  useKeyboard(
    {
      toggleHelp: () => setShowHelp((prev) => !prev),
      newSession: () => {
        inputRef.current?.focus();
        appendSystemMessage("Enter plan request: /plan <description>");
      },
      startBuild: () => {
        if (!isRunning) {
          handleCommand("/build");
          setIsRunning(true);
        }
      },
      cancelBuild: () => {
        if (isRunning) {
          handleCommand("/cancel");
        }
      },
      refresh: () => {
        refreshSessions();
        refreshTasks();
        appendSystemMessage("Status refreshed");
      },
      focusInput: () => {
        inputRef.current?.focus();
      },
      prevTab,
      nextTab,
    },
    isInputFocused,
  );

  // Show session info once when session becomes available
  const hasShownSessionInfoRef = useRef(false);
  if (activeSession && !hasShownSessionInfoRef.current) {
    hasShownSessionInfoRef.current = true;
    queueMicrotask(() => {
      appendSystemMessage(`Active plan: ${activeSession.name}`);
      appendSystemMessage("Press b to start build or /build to run");
      appendSystemMessage("");
    });
  }

  // If help is showing, render overlay
  if (showHelp) {
    return (
      <Box flexDirection="column" width="100%" height={height}>
        <Header />
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <HelpOverlay
            isVisible={showHelp}
            onClose={() => setShowHelp(false)}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%" height={height}>
      <Header />
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
        onNewSession={() => {
          inputRef.current?.focus();
          appendSystemMessage("Enter plan request: /plan <description>");
        }}
      />

      <Box flexGrow={1} minHeight={10} height={height - 8} marginY={1}>
        {/* Fixed width sidebar */}
        <TaskSidebar session={activeSession} isRunning={isRunning} width={30} />
        {/* Output takes remaining space */}
        <TerminalOutput
          maxLines={height - 12}
          onQuestionAnswer={handleQuestionAnswer}
          onApprovalResponse={handleApprovalResponse}
        />
      </Box>

      <Box marginBottom={1}>
        <CommandInput
          ref={inputRef}
          onSubmit={handleCommand}
          onFocusChange={setIsInputFocused}
          placeholder={
            isRunning ? "Type to guide agent..." : "Enter command..."
          }
        />
      </Box>

      <StatusBar session={activeSession} tasks={tasks} isRunning={isRunning} />
    </Box>
  );
};

// Main App wraps content in providers
export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <RpcProvider transport={null}>
        <OutputMachineProvider>
          <AppContent />
        </OutputMachineProvider>
      </RpcProvider>
    </QueryClientProvider>
  );
};
