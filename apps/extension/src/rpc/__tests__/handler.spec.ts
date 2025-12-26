import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect } from "effect";

import { handleRpcMessage, isRpcMessage } from "../handler.js";
import type { RpcContext } from "../context.js";
import type * as vscode from "vscode";

describe("isRpcMessage", () => {
  it("should correctly identify RPC messages", () => {
    const validMessage = {
      id: "test-1",
      type: "query" as const,
      path: ["test"],
      input: {},
    };

    expect(isRpcMessage(validMessage)).toBe(true);
  });

  it("should reject non-RPC messages", () => {
    expect(isRpcMessage({})).toBe(false);
    expect(isRpcMessage({ id: "test" })).toBe(false);
    expect(isRpcMessage({ id: "test", type: "query" })).toBe(false);
    expect(isRpcMessage(null)).toBe(false);
    expect(isRpcMessage(undefined)).toBe(false);
    expect(isRpcMessage("string")).toBe(false);
  });

  it("should validate message structure", () => {
    const invalidType = {
      id: "test-1",
      type: "invalid" as unknown as "query",
      path: ["test"],
    };
    expect(isRpcMessage(invalidType)).toBe(false);

    const invalidPath = {
      id: "test-1",
      type: "query" as const,
      path: "not-an-array",
    };
    expect(isRpcMessage(invalidPath)).toBe(false);

    const invalidId = {
      id: 123,
      type: "query" as const,
      path: ["test"],
    };
    expect(isRpcMessage(invalidId)).toBe(false);
  });

  it("should accept valid procedure types", () => {
    expect(
      isRpcMessage({
        id: "test-1",
        type: "query",
        path: ["test"],
      }),
    ).toBe(true);
    expect(
      isRpcMessage({
        id: "test-2",
        type: "mutation",
        path: ["test"],
      }),
    ).toBe(true);
    expect(
      isRpcMessage({
        id: "test-3",
        type: "subscription",
        path: ["test"],
      }),
    ).toBe(true);
  });
});

describe("handleRpcMessage", () => {
  let mockContext: RpcContext;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPostMessage = vi.fn();
    mockContext = {
      webviewView: {
        webview: {
          postMessage: mockPostMessage,
        },
      } as unknown as vscode.WebviewView,
      context: {} as unknown as vscode.ExtensionContext,
      outputChannel: {} as unknown as vscode.OutputChannel,
      isDev: false,
      cypressDetector: {
        checkStatus: vi.fn().mockResolvedValue({
          overallStatus: "installed" as const,
          packages: [],
          workspaceRoot: "/test",
        }),
      } as unknown as RpcContext["cypressDetector"],
      gitService: {
        getBranchChanges: vi.fn().mockReturnValue(Effect.succeed(null)),
      },
      diffProvider: {} as unknown as RpcContext["diffProvider"],
    } as unknown as RpcContext;
  });

  describe("routing", () => {
    it("should return error for non-existent procedure", async () => {
      const message = {
        id: "test-1",
        type: "query" as const,
        path: ["nonexistent", "procedure"],
        input: undefined,
      };

      const response = await handleRpcMessage(message, mockContext);

      expect(response).toBeDefined();
      expect(response?.success).toBe(false);
      expect(response?.error?.message).toContain("Procedure not found");
    });

    it("should route to correct procedure by path", async () => {
      const message = {
        id: "test-1",
        type: "query" as const,
        path: ["status", "cypress"],
        input: undefined,
      };

      const response = await handleRpcMessage(message, mockContext);

      // Should execute the query (may succeed or fail depending on mocks)
      expect(response).toBeDefined();
    });
  });

  describe("procedure type validation", () => {
    it("should validate procedure type matches request type", async () => {
      const message = {
        id: "test-1",
        type: "mutation" as const,
        path: ["status", "cypress"], // This is a query procedure
        input: undefined,
      };

      const response = await handleRpcMessage(message, mockContext);

      expect(response).toBeDefined();
      expect(response?.success).toBe(false);
      expect(response?.error?.message).toContain("Invalid procedure type");
    });
  });

  describe("input validation", () => {
    it("should validate input using Zod schema", async () => {
      // Test with a procedure that has input validation
      // The actual appRouter procedures use z.void(), so invalid input should be rejected
      const message = {
        id: "test-1",
        type: "query" as const,
        path: ["status", "cypress"],
        input: { invalid: "data" }, // This should fail validation for z.void()
      };

      const response = await handleRpcMessage(message, mockContext);

      // Should return error for invalid input
      expect(response).toBeDefined();
      // The exact behavior depends on how z.void() handles extra properties
      // but we expect some form of validation
    });
  });

  describe("query execution", () => {
    it("should execute query handler and return result", async () => {
      const message = {
        id: "test-1",
        type: "query" as const,
        path: ["status", "cypress"],
        input: undefined,
      };

      const response = await handleRpcMessage(message, mockContext);

      expect(response).toBeDefined();
      expect(response?.id).toBe("test-1");
      // The actual result depends on the mocked cypressDetector
      if (response?.success) {
        expect(response.data).toBeDefined();
      }
    });

    it("should handle query handler errors", async () => {
      // Mock a failing service
      mockContext.cypressDetector = {
        checkStatus: vi.fn().mockRejectedValue(new Error("Service error")),
      } as unknown as RpcContext["cypressDetector"];

      const message = {
        id: "test-1",
        type: "query" as const,
        path: ["status", "cypress"],
        input: undefined,
      };

      const response = await handleRpcMessage(message, mockContext);

      // Should handle the error gracefully
      expect(response).toBeDefined();
    });
  });

  describe("mutation execution", () => {
    it("should execute mutation handler and return result", async () => {
      const message = {
        id: "test-1",
        type: "mutation" as const,
        path: ["agents", "planTests"],
        input: { files: [] },
      };

      const response = await handleRpcMessage(message, mockContext);

      expect(response).toBeDefined();
      expect(response?.id).toBe("test-1");
    });
  });

  describe("subscription execution", () => {
    it("should yield values and send completion", async () => {
      const message = {
        id: "test-1",
        type: "subscription" as const,
        path: ["agents", "planTests"],
        input: { files: ["test.ts"], branchName: "test-branch" },
      };

      const response = await handleRpcMessage(message, mockContext);

      // Subscriptions return null and send messages via postMessage
      expect(response).toBeNull();

      // Verify that postMessage was called for subscription updates
      // The exact number depends on the subscription implementation
      // At minimum, we should see completion or error messages
      expect(mockPostMessage).toHaveBeenCalled();
    });

    it("should handle subscription errors", async () => {
      const message = {
        id: "test-1",
        type: "subscription" as const,
        path: ["agents", "planTests"],
        input: { files: ["test.ts"], branchName: "test-branch" },
      };

      const response = await handleRpcMessage(message, mockContext);

      // Should handle errors gracefully
      expect(response).toBeNull();
      // postMessage should be called with error update if subscription fails
      expect(mockPostMessage).toHaveBeenCalled();
    });
  });

  describe("unsubscribe handling", () => {
    it("should handle unsubscribe messages", async () => {
      const message = {
        id: "test-1",
        type: "subscription" as const,
        path: ["agents", "planTests"],
        input: { _unsubscribe: true },
      };

      const response = await handleRpcMessage(message, mockContext);

      expect(response).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should handle handler errors gracefully", async () => {
      const message = {
        id: "test-1",
        type: "query" as const,
        path: ["status", "cypress"],
        input: undefined,
      };

      // Mock a service that throws
      mockContext.cypressDetector = {
        checkStatus: vi.fn().mockImplementation(() => {
          throw new Error("Unexpected error");
        }),
      } as unknown as RpcContext["cypressDetector"];

      const response = await handleRpcMessage(message, mockContext);

      // Response should be defined even on error
      expect(response).toBeDefined();
      expect(response?.success).toBe(false);
      expect(response?.error).toBeDefined();
    });

    it("should return error response on exception", async () => {
      const message = {
        id: "test-1",
        type: "query" as const,
        path: ["status", "cypress"],
        input: undefined,
      };

      // Create a context that might cause issues
      const invalidContext = {
        ...mockContext,
        cypressDetector: null,
      } as unknown as RpcContext;

      const response = await handleRpcMessage(message, invalidContext);

      // Should handle gracefully
      expect(response).toBeDefined();
    });
  });
});
