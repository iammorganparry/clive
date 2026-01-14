import { QueryClientProvider } from "@tanstack/react-query";
import { Box, useStdout } from "ink";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  executeCommand,
  sendApprovalResponse,
  sendQuestionAnswer,
  sendUserMessage,
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

  // Cache initial dimensions to prevent flicker on resize
  const initialDimensions = useRef({
    width: stdout?.columns ?? 80,
    height: stdout?.rows ?? 24,
  });

  // Only update dimensions if significantly changed (debounce small fluctuations)
  const { width, height } = useMemo(() => {
    const newWidth = stdout?.columns ?? 80;
    const newHeight = stdout?.rows ?? 24;

    if (
      Math.abs(newWidth - initialDimensions.current.width) > 2 ||
      Math.abs(newHeight - initialDimensions.current.height) > 2
    ) {
      initialDimensions.current = { width: newWidth, height: newHeight };
    }

    return initialDimensions.current;
  }, [stdout?.columns, stdout?.rows]);

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

  // Tasks from React Query - auto-polls when running
  const { tasks, refresh: refreshTasks } = useTasks(activeSession, isRunning);

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
    },
    [],
  );

  const handleApprovalResponse = useCallback(
    (toolCallId: string, approved: boolean) => {
      sendApprovalResponse(toolCallId, approved);
    },
    [],
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
      <Box flexDirection="column" width={width} height={height}>
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
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
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
        {/* TaskSidebar uses React Query for task polling */}
        <TaskSidebar session={activeSession} isRunning={isRunning} />
        {/* TerminalOutput subscribes to lines directly from machine */}
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
