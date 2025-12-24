import { useSelector } from "@xstate/react";
import { useFileTestActors } from "../../../contexts/file-test-actors-context.js";

export function useFileTestActor(filePath: string) {
  const { getOrCreateActor } = useFileTestActors();

  // Get or create the actor from the global context
  const actor = getOrCreateActor(filePath);

  // Use useSelector to subscribe to the actor's state
  const state = useSelector(actor, (snapshot) => snapshot);

  return {
    actor,
    state,
    send: actor.send,
    snapshot: state,
  };
}
