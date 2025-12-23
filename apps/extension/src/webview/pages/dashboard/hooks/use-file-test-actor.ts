import { useMachine } from "@xstate/react";
import { fileTestMachine } from "../machines/file-test-machine.js";
import type { VSCodeAPI } from "../../../services/vscode.js";

export function useFileTestActor(filePath: string, vscode: VSCodeAPI) {
  const [state, send, actor] = useMachine(fileTestMachine, {
    id: `file-test-${filePath}`,
    input: {
      filePath,
      vscode,
    },
  });

  return {
    actor,
    state,
    send,
    snapshot: state,
  };
}
