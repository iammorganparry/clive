/**
 * Extract error message from unknown error type
 * Handles Error instances, strings, and other types safely
 */
export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
};

/**
 * Wrap an unknown error into a tagged Error class
 * Useful for converting caught errors into Effect error types
 */
export const wrapError =
  <E extends { message: string; cause?: unknown }>(
    ErrorClass: new (args: { message: string; cause?: unknown }) => E,
  ) =>
  (error: unknown): E =>
    new ErrorClass({ message: extractErrorMessage(error), cause: error });
