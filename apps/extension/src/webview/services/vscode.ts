import { Context, Layer } from "effect";

// Acquire VS Code API
declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

export class VSCode extends Context.Tag("VSCode")<
  VSCode,
  {
    readonly postMessage: (message: unknown) => void;
    readonly getState: () => unknown;
    readonly setState: (state: unknown) => void;
  }
>() {}

export const VSCodeLive = Layer.succeed(VSCode, {
  postMessage: (message: unknown) => {
    vscode.postMessage(message);
  },
  getState: () => {
    return vscode.getState();
  },
  setState: (state: unknown) => {
    vscode.setState(state);
  },
});
