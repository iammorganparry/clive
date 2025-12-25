import { Data } from "effect";

/**
 * Shared error types used across multiple services
 * Consolidates duplicate error class definitions
 */

/**
 * Error for secret storage operations
 */
export class SecretStorageError extends Data.TaggedError("SecretStorageError")<{
  message: string;
}> {}

/**
 * Error for file operation failures
 */
export class FileOperationError extends Data.TaggedError("FileOperationError")<{
  message: string;
  cause?: unknown;
}> {}
