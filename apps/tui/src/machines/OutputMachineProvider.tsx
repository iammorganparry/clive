import { useMachine, useSelector } from "@xstate/react";
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
} from "react";
import type { ActorRefFrom } from "xstate";
import type { OutputLine } from "../types.js";
import type { AgentQuestion } from "../utils/claude-events.js";
import {
  type OutputContext,
  outputMachine,
  type PendingInteraction,
} from "./output-machine.js";

type OutputActorRef = ActorRefFrom<typeof outputMachine>;

// Context for the actor reference
const OutputActorContext = createContext<OutputActorRef | null>(null);

// Provider component - creates the machine once
export const OutputMachineProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [, , actorRef] = useMachine(outputMachine);

  return (
    <OutputActorContext.Provider value={actorRef}>
      {children}
    </OutputActorContext.Provider>
  );
};

// Hook to get the actor (throws if not in provider)
function useOutputActor(): OutputActorRef {
  const actorRef = useContext(OutputActorContext);
  if (!actorRef) {
    throw new Error("useOutputActor must be used within OutputMachineProvider");
  }
  return actorRef;
}

// Selectors
const selectLines = (state: { context: OutputContext }) => state.context.lines;
const selectIsRunning = (state: { context: OutputContext }) =>
  state.context.isRunning;
const selectStartTime = (state: { context: OutputContext }) =>
  state.context.startTime;
const selectPendingInteraction = (state: { context: OutputContext }) =>
  state.context.pendingInteraction;

// Hook for components that need actions (App, Commands)
// Does NOT subscribe to lines - prevents re-renders from output updates
export function useOutputActions() {
  const actorRef = useOutputActor();

  const appendOutput = useCallback(
    (text: string, type?: OutputLine["type"]) => {
      actorRef.send({ type: "APPEND_OUTPUT", text, outputType: type });
    },
    [actorRef],
  );

  const appendSystemMessage = useCallback(
    (text: string) => {
      actorRef.send({ type: "APPEND_SYSTEM", text });
    },
    [actorRef],
  );

  const setIsRunning = useCallback(
    (running: boolean) => {
      actorRef.send({ type: running ? "START_RUNNING" : "STOP_RUNNING" });
    },
    [actorRef],
  );

  const clear = useCallback(() => {
    actorRef.send({ type: "CLEAR" });
  }, [actorRef]);

  // Only subscribe to isRunning (infrequent changes)
  const isRunning = useSelector(actorRef, selectIsRunning);
  const startTime = useSelector(actorRef, selectStartTime);

  return {
    appendOutput,
    appendSystemMessage,
    setIsRunning,
    clear,
    isRunning,
    startTime,
  };
}

// Hook for TerminalOutput - subscribes to lines (high frequency updates)
export function useOutputLines() {
  const actorRef = useOutputActor();
  const lines = useSelector(actorRef, selectLines);
  return lines;
}

// Hook for components that need running state (StatusBar, Spinner)
export function useRunningState() {
  const actorRef = useOutputActor();
  const isRunning = useSelector(actorRef, selectIsRunning);
  const startTime = useSelector(actorRef, selectStartTime);
  return { isRunning, startTime };
}

// Hook for components that need pending interaction state (TerminalOutput)
export function usePendingInteraction() {
  const actorRef = useOutputActor();
  const pendingInteraction = useSelector(actorRef, selectPendingInteraction);
  return pendingInteraction;
}

// Hook for sending interaction events
export function useInteractionActions() {
  const actorRef = useOutputActor();

  const sendQuestion = useCallback(
    (id: string, questions: AgentQuestion[]) => {
      actorRef.send({ type: "QUESTION_RECEIVED", id, questions });
    },
    [actorRef],
  );

  const sendApprovalRequest = useCallback(
    (id: string, toolName: string, args: unknown) => {
      actorRef.send({ type: "APPROVAL_REQUESTED", id, toolName, args });
    },
    [actorRef],
  );

  const resolveInteraction = useCallback(() => {
    actorRef.send({ type: "INTERACTION_RESOLVED" });
  }, [actorRef]);

  return {
    sendQuestion,
    sendApprovalRequest,
    resolveInteraction,
  };
}
