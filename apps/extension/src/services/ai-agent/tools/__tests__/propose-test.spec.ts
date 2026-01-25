import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposeTestInput } from "../../types";
import { createProposeTestTool } from "../propose-test";
import { executeTool } from "./test-helpers";

// Mock hitl-utils
vi.mock("../../hitl-utils", () => ({
  processProposeTestApproval: vi.fn(
    (_input: ProposeTestInput, approved: boolean) => ({
      success: approved,
      id: approved ? `test-${Date.now()}` : "",
      message: approved ? "Proposal approved" : "Proposal rejected",
    }),
  ),
}));

describe("proposeTestTool", () => {
  let approvalRegistry: Set<string>;
  let waitForApproval:
    | ((toolCallId: string, input: ProposeTestInput) => Promise<boolean>)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    approvalRegistry = new Set<string>();
    waitForApproval = undefined;
  });

  describe("Auto-Approval Mode", () => {
    it("should auto-approve when no approval callback provided", async () => {
      const tool = createProposeTestTool(undefined, approvalRegistry);

      const input: ProposeTestInput = {
        sourceFile: "src/component.tsx",
        testStrategies: [
          {
            testType: "unit",
            framework: "vitest",
            targetTestPath: "src/component.test.tsx",
            description: "Test component rendering",
            isUpdate: false,
            testCases: [],
          },
        ],
      };

      const result = await executeTool(tool, input, { success: false });

      expect(result.success).toBe(true);
      expect(approvalRegistry.size).toBe(1);
    });

    it("should register approved ID in registry when auto-approved", async () => {
      const tool = createProposeTestTool(undefined, approvalRegistry);

      const input: ProposeTestInput = {
        sourceFile: "src/component.tsx",
        testStrategies: [
          {
            testType: "unit",
            framework: "vitest",
            targetTestPath: "src/component.test.tsx",
            description: "Test component",
            isUpdate: false,
            testCases: [],
          },
        ],
      };

      await executeTool(tool, input, { success: false });

      expect(approvalRegistry.size).toBe(1);
      const registeredId = Array.from(approvalRegistry)[0];
      expect(registeredId).toBeDefined();
    });
  });

  describe("Manual Approval Mode", () => {
    it("should wait for approval when callback provided", async () => {
      waitForApproval = vi.fn().mockResolvedValue(true);

      const tool = createProposeTestTool(waitForApproval, approvalRegistry);

      const input: ProposeTestInput = {
        sourceFile: "src/component.tsx",
        testStrategies: [
          {
            testType: "unit",
            framework: "vitest",
            targetTestPath: "src/component.test.tsx",
            description: "Test component",
            isUpdate: false,
            testCases: [],
          },
        ],
      };

      const result = await executeTool(tool, input, { success: false });

      expect(result.success).toBe(true);
      expect(waitForApproval).toHaveBeenCalled();
      expect(approvalRegistry.size).toBe(1);
    });

    it("should handle rejection", async () => {
      waitForApproval = vi.fn().mockResolvedValue(false);

      const tool = createProposeTestTool(waitForApproval, approvalRegistry);

      const input: ProposeTestInput = {
        sourceFile: "src/component.tsx",
        testStrategies: [
          {
            testType: "unit",
            framework: "vitest",
            targetTestPath: "src/component.test.tsx",
            description: "Test component",
            isUpdate: false,
            testCases: [],
          },
        ],
      };

      const result = await executeTool(tool, input, { success: false });

      expect(result.success).toBe(false);
      expect(waitForApproval).toHaveBeenCalled();
      expect(approvalRegistry.size).toBe(0);
    });

    it("should generate unique tool call ID", async () => {
      waitForApproval = vi.fn().mockResolvedValue(true);

      const tool = createProposeTestTool(waitForApproval);

      const input: ProposeTestInput = {
        sourceFile: "src/component.tsx",
        testStrategies: [
          {
            testType: "unit",
            framework: "vitest",
            targetTestPath: "src/component.test.tsx",
            description: "Test component",
            isUpdate: false,
            testCases: [],
          },
        ],
      };

      await executeTool(tool, input, { success: false });

      expect(waitForApproval).toHaveBeenCalled();
      const toolCallId = (waitForApproval as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(toolCallId).toContain("propose-");
    });

    it("should not register ID when rejected", async () => {
      waitForApproval = vi.fn().mockResolvedValue(false);

      const tool = createProposeTestTool(waitForApproval, approvalRegistry);

      const input: ProposeTestInput = {
        sourceFile: "src/component.tsx",
        testStrategies: [
          {
            testType: "unit",
            framework: "vitest",
            targetTestPath: "src/component.test.tsx",
            description: "Test component",
            isUpdate: false,
            testCases: [],
          },
        ],
      };

      await executeTool(tool, input, { success: false });

      expect(approvalRegistry.size).toBe(0);
    });
  });

  describe("Input Validation", () => {
    it("should accept valid test strategies", async () => {
      const tool = createProposeTestTool();

      const input: ProposeTestInput = {
        sourceFile: "src/component.tsx",
        testStrategies: [
          {
            testType: "unit",
            framework: "vitest",
            targetTestPath: "src/component.test.tsx",
            description: "Unit tests",
            isUpdate: false,
            prerequisites: ["setup"],
            mockDependencies: ["dependency"],
            testSetup: ["setup step"],
            testCases: [
              {
                name: "Test case 1",
                testType: "unit",
                category: "happy_path",
                userActions: [],
                assertions: [],
              },
            ],
          },
          {
            testType: "e2e",
            framework: "playwright",
            targetTestPath: "e2e/component.spec.ts",
            description: "E2E tests",
            isUpdate: false,
            navigationPath: "/component",
            pageContext: "ComponentPage",
            userFlow: "User flow description",
            testCases: [],
          },
        ],
        relatedTests: ["existing-test.ts"],
      };

      const result = await executeTool(tool, input, { success: false });

      expect(result.success).toBe(true);
    });
  });
});
