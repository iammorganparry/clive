import { useMachine, useSelector } from "@xstate/react";
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
} from "react";
import type { ActorRefFrom } from "xstate";
import type { Session, Task } from "../types.js";
import { type TasksContext, tasksMachine } from "./tasks-machine.js";

type TasksActorRef = ActorRefFrom<typeof tasksMachine>;

// Context for the actor reference
const TasksActorContext = createContext<TasksActorRef | null>(null);

// Provider component
export const TasksMachineProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [, , actorRef] = useMachine(tasksMachine);

  return (
    <TasksActorContext.Provider value={actorRef}>
      {children}
    </TasksActorContext.Provider>
  );
};

// Hook to get the actor
function useTasksActor(): TasksActorRef {
  const actorRef = useContext(TasksActorContext);
  if (!actorRef) {
    throw new Error("useTasksActor must be used within TasksMachineProvider");
  }
  return actorRef;
}

// Selectors
const selectTasks = (state: { context: TasksContext }) => state.context.tasks;
const selectEpicName = (state: { context: TasksContext }) =>
  state.context.epicName;
const selectSkill = (state: { context: TasksContext }) => state.context.skill;
const selectCategory = (state: { context: TasksContext }) =>
  state.context.category;

// Hook for components that need task actions (App)
export function useTasksActions() {
  const actorRef = useTasksActor();

  const setSession = useCallback(
    (session: Session | null) => {
      actorRef.send({ type: "SET_SESSION", session });
    },
    [actorRef],
  );

  const setPolling = useCallback(
    (polling: boolean) => {
      actorRef.send({ type: "SET_POLLING", polling });
    },
    [actorRef],
  );

  const refresh = useCallback(() => {
    actorRef.send({ type: "REFRESH" });
  }, [actorRef]);

  return { setSession, setPolling, refresh };
}

// Hook for TaskSidebar - subscribes to tasks
export function useTasksList() {
  const actorRef = useTasksActor();
  const tasks = useSelector(actorRef, selectTasks);
  const epicName = useSelector(actorRef, selectEpicName);
  const skill = useSelector(actorRef, selectSkill);
  const category = useSelector(actorRef, selectCategory);

  return { tasks, epicName, skill, category };
}

// Combined hook for session/polling control (convenience)
export function useTasksWithSession(
  session: Session | null,
  isRunning: boolean,
) {
  const actorRef = useTasksActor();
  const { setSession, setPolling } = useTasksActions();

  // Update session when it changes
  useEffect(() => {
    setSession(session);
  }, [session, setSession]);

  // Update polling when isRunning changes
  useEffect(() => {
    setPolling(isRunning);
  }, [isRunning, setPolling]);

  // Return tasks data
  const tasks = useSelector(actorRef, selectTasks);
  const epicName = useSelector(actorRef, selectEpicName);
  const skill = useSelector(actorRef, selectSkill);

  return { tasks, epicName, skill };
}
