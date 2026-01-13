import React, { createContext, useContext, type ReactNode } from 'react';
import { useMachine, useSelector } from '@xstate/react';
import { useCallback } from 'react';
import { outputMachine, type OutputContext } from './output-machine.js';
import type { OutputLine } from '../types.js';
import type { ActorRefFrom } from 'xstate';

type OutputActorRef = ActorRefFrom<typeof outputMachine>;

// Context for the actor reference
const OutputActorContext = createContext<OutputActorRef | null>(null);

// Provider component - creates the machine once
export const OutputMachineProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
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
    throw new Error('useOutputActor must be used within OutputMachineProvider');
  }
  return actorRef;
}

// Selectors
const selectLines = (state: { context: OutputContext }) => state.context.lines;
const selectIsRunning = (state: { context: OutputContext }) => state.context.isRunning;
const selectStartTime = (state: { context: OutputContext }) => state.context.startTime;

// Hook for components that need actions (App, Commands)
// Does NOT subscribe to lines - prevents re-renders from output updates
export function useOutputActions() {
  const actorRef = useOutputActor();

  const appendOutput = useCallback((text: string, type?: OutputLine['type']) => {
    actorRef.send({ type: 'APPEND_OUTPUT', text, outputType: type });
  }, [actorRef]);

  const appendSystemMessage = useCallback((text: string) => {
    actorRef.send({ type: 'APPEND_SYSTEM', text });
  }, [actorRef]);

  const setIsRunning = useCallback((running: boolean) => {
    actorRef.send({ type: running ? 'START_RUNNING' : 'STOP_RUNNING' });
  }, [actorRef]);

  const clear = useCallback(() => {
    actorRef.send({ type: 'CLEAR' });
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
