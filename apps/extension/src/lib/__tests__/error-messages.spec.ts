import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  getErrorCodeFromStatus,
  getErrorCodeFromTrpc,
  getErrorMessage,
  parseTrpcError,
} from "../error-messages.js";

describe("error-messages", () => {
  describe("getErrorMessage", () => {
    it("should return correct message for NETWORK error code", () => {
      expect(getErrorMessage(ErrorCode.NETWORK)).toBe(
        "Unable to connect to the server. Check your connection.",
      );
    });

    it("should return correct message for AUTH_REQUIRED error code", () => {
      expect(getErrorMessage(ErrorCode.AUTH_REQUIRED)).toBe(
        "Please log in to use this feature.",
      );
    });

    it("should return correct message for NOT_FOUND error code", () => {
      expect(getErrorMessage(ErrorCode.NOT_FOUND)).toBe(
        "The requested resource could not be found.",
      );
    });

    it("should return correct message for FORBIDDEN error code", () => {
      expect(getErrorMessage(ErrorCode.FORBIDDEN)).toBe(
        "You don't have permission to access this resource.",
      );
    });

    it("should return correct message for SERVER_ERROR error code", () => {
      expect(getErrorMessage(ErrorCode.SERVER_ERROR)).toBe(
        "Something went wrong. Please try again.",
      );
    });

    it("should return correct message for UNKNOWN error code", () => {
      expect(getErrorMessage(ErrorCode.UNKNOWN)).toBe(
        "An unexpected error occurred. Please try again.",
      );
    });
  });

  describe("getErrorCodeFromStatus", () => {
    it("should map 401 to FORBIDDEN", () => {
      expect(getErrorCodeFromStatus(401)).toBe(ErrorCode.FORBIDDEN);
    });

    it("should map 403 to FORBIDDEN", () => {
      expect(getErrorCodeFromStatus(403)).toBe(ErrorCode.FORBIDDEN);
    });

    it("should map 404 to NOT_FOUND", () => {
      expect(getErrorCodeFromStatus(404)).toBe(ErrorCode.NOT_FOUND);
    });

    it("should map 500 to SERVER_ERROR", () => {
      expect(getErrorCodeFromStatus(500)).toBe(ErrorCode.SERVER_ERROR);
    });

    it("should map 502 to SERVER_ERROR", () => {
      expect(getErrorCodeFromStatus(502)).toBe(ErrorCode.SERVER_ERROR);
    });

    it("should map 503 to SERVER_ERROR", () => {
      expect(getErrorCodeFromStatus(503)).toBe(ErrorCode.SERVER_ERROR);
    });

    it("should map status >= 500 to SERVER_ERROR", () => {
      expect(getErrorCodeFromStatus(599)).toBe(ErrorCode.SERVER_ERROR);
    });

    it("should map unknown status codes to UNKNOWN", () => {
      expect(getErrorCodeFromStatus(200)).toBe(ErrorCode.UNKNOWN);
      expect(getErrorCodeFromStatus(400)).toBe(ErrorCode.UNKNOWN);
      expect(getErrorCodeFromStatus(429)).toBe(ErrorCode.UNKNOWN);
    });
  });

  describe("getErrorCodeFromTrpc", () => {
    it("should map NOT_FOUND to NOT_FOUND error code", () => {
      expect(getErrorCodeFromTrpc("NOT_FOUND")).toBe(ErrorCode.NOT_FOUND);
    });

    it("should map FORBIDDEN to FORBIDDEN error code", () => {
      expect(getErrorCodeFromTrpc("FORBIDDEN")).toBe(ErrorCode.FORBIDDEN);
    });

    it("should map UNAUTHORIZED to AUTH_REQUIRED error code", () => {
      expect(getErrorCodeFromTrpc("UNAUTHORIZED")).toBe(
        ErrorCode.AUTH_REQUIRED,
      );
    });

    it("should map INTERNAL_SERVER_ERROR to SERVER_ERROR error code", () => {
      expect(getErrorCodeFromTrpc("INTERNAL_SERVER_ERROR")).toBe(
        ErrorCode.SERVER_ERROR,
      );
    });

    it("should map unknown tRPC codes to UNKNOWN error code", () => {
      expect(getErrorCodeFromTrpc("BAD_REQUEST")).toBe(ErrorCode.UNKNOWN);
      expect(getErrorCodeFromTrpc("TIMEOUT")).toBe(ErrorCode.UNKNOWN);
      expect(getErrorCodeFromTrpc("")).toBe(ErrorCode.UNKNOWN);
    });
  });

  describe("parseTrpcError", () => {
    it("should extract message from valid tRPC response with error.message", () => {
      const errorText = JSON.stringify({
        error: {
          message: "Custom error message",
        },
      });

      const result = parseTrpcError(errorText, 500);
      expect(result).toBe("Custom error message");
    });

    it("should extract message from valid tRPC response with error.data.message", () => {
      const errorText = JSON.stringify({
        error: {
          data: {
            message: "Data error message",
          },
        },
      });

      const result = parseTrpcError(errorText, 500);
      expect(result).toBe("Data error message");
    });

    it("should prefer error.message over error.data.message", () => {
      const errorText = JSON.stringify({
        error: {
          message: "Top level message",
          data: {
            message: "Data level message",
          },
        },
      });

      const result = parseTrpcError(errorText, 500);
      expect(result).toBe("Top level message");
    });

    it("should map tRPC error code to user-friendly message", () => {
      const errorText = JSON.stringify({
        error: {
          data: {
            code: "NOT_FOUND",
          },
        },
      });

      const result = parseTrpcError(errorText, 500);
      expect(result).toBe("The requested resource could not be found.");
    });

    it("should fallback to status-based message on parse error", () => {
      const invalidJson = "not valid json";

      const result = parseTrpcError(invalidJson, 404);
      expect(result).toBe("The requested resource could not be found.");
    });

    it("should fallback to status-based message when no tRPC message or code", () => {
      const errorText = JSON.stringify({
        error: {},
      });

      const result = parseTrpcError(errorText, 500);
      expect(result).toBe("Something went wrong. Please try again.");
    });

    it("should handle empty error object", () => {
      const errorText = JSON.stringify({});

      const result = parseTrpcError(errorText, 401);
      expect(result).toBe("You don't have permission to access this resource.");
    });

    it("should handle complex tRPC error structure", () => {
      const errorText = JSON.stringify({
        error: {
          message: "Complex error",
          code: -32004,
          data: {
            code: "FORBIDDEN",
            message: "You don't have access",
            httpStatus: 403,
          },
        },
      });

      // Should prefer error.message
      const result = parseTrpcError(errorText, 403);
      expect(result).toBe("Complex error");
    });
  });
});
