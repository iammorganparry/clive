import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { createActor } from "xstate";
import { fileTestMachine } from "../pages/dashboard/machines/file-test-machine.js";
import type { VSCodeAPI } from "../services/vscode.js";
import type { ActorRefFrom } from "xstate";

type FileTestActor = ActorRefFrom<typeof fileTestMachine>;

interface FileTestActorsContextType {
  getOrCreateActor: (filePath: string) => FileTestActor;
  getActor: (filePath: string) => FileTestActor | undefined;
  removeActor: (filePath: string) => void;
}

const FileTestActorsContext = createContext<
  FileTestActorsContextType | undefined
>(undefined);

interface FileTestActorsProviderProps {
  vscode: VSCodeAPI;
  children: ReactNode;
}

export const FileTestActorsProvider = ({
  vscode,
  children,
}: FileTestActorsProviderProps) => {
  // Use useRef to persist the actors map across re-renders
  const actorsRef = useRef<Map<string, FileTestActor>>(new Map());

  const getOrCreateActor = useCallback(
    (filePath: string): FileTestActor => {
      const existing = actorsRef.current.get(filePath);
      if (existing) {
        return existing;
      }

      // Create new actor
      const actor = createActor(fileTestMachine, {
        id: `file-test-${filePath}`,
        input: {
          filePath,
          vscode,
        },
      });

      // Start the actor immediately
      actor.start();

      // Store and return
      actorsRef.current.set(filePath, actor);
      return actor;
    },
    [vscode],
  );

  const getActor = useCallback(
    (filePath: string): FileTestActor | undefined => {
      return actorsRef.current.get(filePath);
    },
    [],
  );

  const removeActor = useCallback((filePath: string) => {
    const actor = actorsRef.current.get(filePath);
    if (actor) {
      actor.stop();
      actorsRef.current.delete(filePath);
    }
  }, []);

  const value = useMemo(
    () => ({
      getOrCreateActor,
      getActor,
      removeActor,
    }),
    [getOrCreateActor, getActor, removeActor],
  );

  return (
    <FileTestActorsContext.Provider value={value}>
      {children}
    </FileTestActorsContext.Provider>
  );
};

export const useFileTestActors = (): FileTestActorsContextType => {
  const context = useContext(FileTestActorsContext);
  if (context === undefined) {
    throw new Error(
      "useFileTestActors must be used within a FileTestActorsProvider",
    );
  }
  return context;
};
