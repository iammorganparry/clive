/**
 * Centralized error message factory for consistent user-friendly error messages
 * across the frontend application.
 */

export const ErrorCode = {
  NETWORK: "NETWORK",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  SERVER_ERROR: "SERVER_ERROR",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

const errorMessages: Record<ErrorCodeType, string> = {
  NETWORK: "Unable to connect to the server. Check your connection.",
  AUTH_REQUIRED: "Please log in to use this feature.",
  NOT_FOUND: "The requested resource could not be found.",
  FORBIDDEN: "You don't have permission to access this resource.",
  SERVER_ERROR: "Something went wrong. Please try again.",
  UNKNOWN: "An unexpected error occurred. Please try again.",
};

/**
 * Get a user-friendly error message for the given error code
 */
export const getErrorMessage = (code: ErrorCodeType): string =>
  errorMessages[code];

/**
 * Map HTTP status codes to error codes
 */
export const getErrorCodeFromStatus = (status: number): ErrorCodeType => {
  if (status === 401 || status === 403) return ErrorCode.FORBIDDEN;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status >= 500) return ErrorCode.SERVER_ERROR;
  return ErrorCode.UNKNOWN;
};

/**
 * Map tRPC error codes to error codes
 */
export const getErrorCodeFromTrpc = (trpcCode: string): ErrorCodeType => {
  switch (trpcCode) {
    case "NOT_FOUND":
      return ErrorCode.NOT_FOUND;
    case "FORBIDDEN":
      return ErrorCode.FORBIDDEN;
    case "UNAUTHORIZED":
      return ErrorCode.AUTH_REQUIRED;
    case "INTERNAL_SERVER_ERROR":
      return ErrorCode.SERVER_ERROR;
    default:
      return ErrorCode.UNKNOWN;
  }
};

/**
 * Parse tRPC error response and return user-friendly message
 */
export const parseTrpcError = (errorText: string, status: number): string => {
  try {
    const errorData = JSON.parse(errorText) as {
      error?: {
        message?: string;
        code?: number;
        data?: {
          code?: string;
          message?: string;
        };
      };
    };

    // Extract error message from tRPC response
    const trpcMessage =
      errorData.error?.message || errorData.error?.data?.message;
    const trpcCode = errorData.error?.data?.code;

    // If we have a tRPC message, use it
    if (trpcMessage) {
      return trpcMessage;
    }

    // Map tRPC error codes to user-friendly messages
    if (trpcCode) {
      const errorCode = getErrorCodeFromTrpc(trpcCode);
      return getErrorMessage(errorCode);
    }
  } catch {
    // If parsing fails, fall back to status-based message
  }

  // Fallback to status-based messages
  const errorCode = getErrorCodeFromStatus(status);
  return getErrorMessage(errorCode);
};
