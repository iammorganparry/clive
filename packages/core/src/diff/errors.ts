import { Data } from "effect";

/**
 * Error types for diff tracking operations
 */
export class DiffTrackerError extends Data.TaggedError("DiffTrackerError")<{
  message: string;
  cause?: unknown;
}> {}

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  message: string;
  cause?: unknown;
}> {}

export class EditorError extends Data.TaggedError("EditorError")<{
  message: string;
  cause?: unknown;
}> {}
