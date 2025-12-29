import { describe, it, expect, vi } from "vitest";
import { createApprovePlanTool } from "../approve-plan";
import type { ApprovePlanInput, ApprovePlanOutput } from "../approve-plan";
import { executeTool } from "./test-helpers";

describe("approvePlanTool", () => {
  describe("Validation", () => {
    it("should reject when no suites provided (empty array)", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-123",
        suites: [],
        userMessage: "looks good",
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(false);
      expect(result.switchedToActMode).toBe(false);
      expect(result.message).toContain("No test suites provided");
    });

    it("should reject when suite is missing id", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-123",
        suites: [
          {
            id: "",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/test.spec.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(false);
      expect(result.switchedToActMode).toBe(false);
      expect(result.message).toContain("Invalid suite");
    });

    it("should reject when suite is missing name", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-123",
        suites: [
          {
            id: "suite-1",
            name: "",
            testType: "unit",
            targetFilePath: "src/__tests__/test.spec.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(false);
      expect(result.switchedToActMode).toBe(false);
      expect(result.message).toContain("Invalid suite");
    });

    it("should reject when suite is missing targetFilePath", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-123",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "",
            sourceFiles: ["src/file.ts"],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(false);
      expect(result.switchedToActMode).toBe(false);
      expect(result.message).toContain("Invalid suite");
    });
  });

  describe("Success Cases", () => {
    it("should approve plan with single valid suite", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-123",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests for Auth",
            testType: "unit",
            targetFilePath: "src/auth/__tests__/auth.test.ts",
            sourceFiles: ["src/auth/login.ts"],
          },
        ],
        userMessage: "looks good",
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.switchedToActMode).toBe(true);
      expect(result.planId).toBe("test-plan-123");
      expect(result.suiteCount).toBe(1);
      expect(result.message).toContain("Plan approved");
      expect(result.message).toContain("1 test suite");
      expect(result.message).not.toContain("suites"); // Should be singular
    });

    it("should approve plan with multiple valid suites", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-456",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests for Auth",
            testType: "unit",
            targetFilePath: "src/auth/__tests__/auth.test.ts",
            sourceFiles: ["src/auth/login.ts"],
          },
          {
            id: "suite-2",
            name: "Integration Tests for Auth Flow",
            testType: "integration",
            targetFilePath: "src/auth/__tests__/auth-flow.test.ts",
            sourceFiles: ["src/auth/middleware.ts"],
          },
        ],
        userMessage: "approved",
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.switchedToActMode).toBe(true);
      expect(result.planId).toBe("test-plan-456");
      expect(result.suiteCount).toBe(2);
      expect(result.message).toContain("Plan approved");
      expect(result.message).toContain("2 test suites"); // Should be plural
    });

    it("should return correct output structure", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-789",
        suites: [
          {
            id: "suite-1",
            name: "E2E Tests",
            testType: "e2e",
            targetFilePath: "e2e/flow.spec.ts",
            sourceFiles: [],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("planId");
      expect(result).toHaveProperty("suiteCount");
      expect(result).toHaveProperty("switchedToActMode");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.message).toBe("string");
      expect(typeof result.planId).toBe("string");
      expect(typeof result.suiteCount).toBe("number");
      expect(typeof result.switchedToActMode).toBe("boolean");
    });

    it("should handle plan approval without userMessage", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-no-message",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/test.spec.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.switchedToActMode).toBe(true);
    });
  });

  describe("Progress Callback Tests", () => {
    it("should call progressCallback with plan-approved status", async () => {
      const progressCallback = vi.fn();
      const tool = createApprovePlanTool(progressCallback);

      const input: ApprovePlanInput = {
        planId: "test-plan-callback",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/test.spec.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
        userMessage: "proceed",
      };

      await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(progressCallback).toHaveBeenCalledWith(
        "plan-approved",
        expect.any(String),
      );
    });

    it("should include serialized event data in callback", async () => {
      const progressCallback = vi.fn();
      const tool = createApprovePlanTool(progressCallback);

      const input: ApprovePlanInput = {
        planId: "test-plan-data",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/test.spec.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
        userMessage: "looks great",
      };

      await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(progressCallback).toHaveBeenCalledTimes(1);
      const callArgs = progressCallback.mock.calls[0];
      expect(callArgs[0]).toBe("plan-approved");

      const eventData = JSON.parse(callArgs[1]);
      expect(eventData.type).toBe("plan-approved");
      expect(eventData.planId).toBe("test-plan-data");
      expect(eventData.suites).toHaveLength(1);
      expect(eventData.suites[0].id).toBe("suite-1");
      expect(eventData.userMessage).toBe("looks great");
    });

    it("should work without callback (undefined)", async () => {
      const tool = createApprovePlanTool(undefined);

      const input: ApprovePlanInput = {
        planId: "test-plan-no-callback",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/test.spec.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.switchedToActMode).toBe(true);
    });

    it("should not call callback when validation fails", async () => {
      const progressCallback = vi.fn();
      const tool = createApprovePlanTool(progressCallback);

      const input: ApprovePlanInput = {
        planId: "test-plan-invalid",
        suites: [], // Empty suites should fail validation
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(false);
      expect(progressCallback).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle large number of suites", async () => {
      const tool = createApprovePlanTool();

      const suites = Array.from({ length: 50 }, (_, i) => ({
        id: `suite-${i + 1}`,
        name: `Test Suite ${i + 1}`,
        testType: "unit" as const,
        targetFilePath: `src/__tests__/test-${i + 1}.spec.ts`,
        sourceFiles: [`src/file-${i + 1}.ts`],
      }));

      const input: ApprovePlanInput = {
        planId: "test-plan-large",
        suites,
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.suiteCount).toBe(50);
      expect(result.message).toContain("50 test suites");
    });

    it("should handle suites with optional description field", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-description",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/test.spec.ts",
            sourceFiles: ["src/file.ts"],
            description: "Tests for core authentication logic",
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.switchedToActMode).toBe(true);
    });

    it("should handle suites with empty sourceFiles array", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-no-sources",
        suites: [
          {
            id: "suite-1",
            name: "E2E Tests",
            testType: "e2e",
            targetFilePath: "e2e/flow.spec.ts",
            sourceFiles: [],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.switchedToActMode).toBe(true);
    });

    it("should handle all test types (unit, integration, e2e)", async () => {
      const tool = createApprovePlanTool();

      const input: ApprovePlanInput = {
        planId: "test-plan-all-types",
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/unit.test.ts",
            sourceFiles: ["src/file.ts"],
          },
          {
            id: "suite-2",
            name: "Integration Tests",
            testType: "integration",
            targetFilePath: "src/__tests__/integration.test.ts",
            sourceFiles: ["src/service.ts"],
          },
          {
            id: "suite-3",
            name: "E2E Tests",
            testType: "e2e",
            targetFilePath: "e2e/flow.spec.ts",
            sourceFiles: [],
          },
        ],
      };

      const result = await executeTool(tool, input, {} as ApprovePlanOutput);

      expect(result.success).toBe(true);
      expect(result.suiteCount).toBe(3);
    });
  });
});
