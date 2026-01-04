/**
 * proposeTestPlan MCP Tool Tests
 * Tests for test plan proposal with bridge integration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the extension bridge
vi.mock("../../bridge/extension-bridge.js", () => ({
  ensureBridgeConnected: vi.fn(),
}));

// Import after mocks
import { ensureBridgeConnected } from "../../bridge/extension-bridge.js";

// Mock MCP server
const mockTool = vi.fn();
const mockServer = {
  tool: mockTool,
};

// Valid test input that satisfies the schema
function createValidInput(overrides = {}) {
  return {
    name: "Test Plan for Authentication",
    overview: "Comprehensive tests for auth module",
    suites: [
      {
        id: "suite-1-unit-auth",
        name: "Unit Tests for Authentication Logic",
        testType: "unit" as const,
        targetFilePath: "src/auth/__tests__/auth.test.ts",
        sourceFiles: ["src/auth/auth.ts"],
        description: "Tests auth logic",
      },
    ],
    mockDependencies: [
      {
        dependency: "database",
        mockStrategy: "factory" as const,
      },
    ],
    discoveredPatterns: {
      testFramework: "vitest",
      mockFactoryPaths: ["src/__tests__/mock-factories"],
      testPatterns: ["describe/it pattern"],
    },
    planContent: "# Test Plan\n\nContent here",
    ...overrides,
  };
}

describe("proposeTestPlan MCP Tool", () => {
  let toolHandler: (
    input: ReturnType<typeof createValidInput>,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
  let mockBridge: { call: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Create mock bridge
    mockBridge = {
      call: vi.fn().mockResolvedValue({
        success: true,
        planId: "plan-123",
        filePath: ".clive/plans/test-plan.md",
        message: "Test plan created",
      }),
    };
    vi.mocked(ensureBridgeConnected).mockResolvedValue(mockBridge as never);

    // Import and register the tool
    const { registerProposeTestPlan } = await import("../propose-test-plan.js");
    registerProposeTestPlan(mockServer as never);

    // Capture the tool handler
    toolHandler = mockTool.mock.calls[0][3];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("tool registration", () => {
    it("registers tool with correct name and description", () => {
      expect(mockTool).toHaveBeenCalled();
      const [name, description] = mockTool.mock.calls[0];

      expect(name).toBe("proposeTestPlan");
      expect(description).toContain("test plan proposal");
      expect(description).toContain("PLAN MODE");
    });

    it("registers with Zod schema shape", () => {
      const schema = mockTool.mock.calls[0][2];

      expect(schema).toHaveProperty("name");
      expect(schema).toHaveProperty("overview");
      expect(schema).toHaveProperty("suites");
      expect(schema).toHaveProperty("mockDependencies");
      expect(schema).toHaveProperty("discoveredPatterns");
      expect(schema).toHaveProperty("planContent");
    });
  });

  describe("bridge connection", () => {
    it("connects to bridge before calling", async () => {
      await toolHandler(createValidInput());

      expect(ensureBridgeConnected).toHaveBeenCalled();
    });

    it("handles bridge connection error", async () => {
      vi.mocked(ensureBridgeConnected).mockRejectedValue(
        new Error("Socket not available"),
      );

      const result = await toolHandler(createValidInput());

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Socket not available");
    });
  });

  describe("request handling", () => {
    it("sends correct params to bridge", async () => {
      const input = createValidInput();
      await toolHandler(input);

      expect(mockBridge.call).toHaveBeenCalledWith("proposeTestPlan", {
        ...input,
        toolCallId: expect.stringMatching(/^propose-plan-\d+-[a-z0-9]+$/),
      });
    });

    it("generates unique toolCallId", async () => {
      await toolHandler(createValidInput());
      await toolHandler(createValidInput());

      const call1 = mockBridge.call.mock.calls[0][1];
      const call2 = mockBridge.call.mock.calls[1][1];

      expect(call1.toolCallId).not.toBe(call2.toolCallId);
    });

    it("includes optional fields when provided", async () => {
      const input = createValidInput({
        externalDependencies: [
          {
            type: "database",
            name: "PostgreSQL",
            testStrategy: "Use test database",
          },
        ],
        regressionAnalysis: {
          relatedTestFiles: ["auth.test.ts"],
          testsRun: 10,
          passed: 8,
          failed: 2,
          failures: [],
          summary: "2 failures need investigation",
        },
      });

      await toolHandler(input);

      const bridgeCall = mockBridge.call.mock.calls[0][1];
      expect(bridgeCall.externalDependencies).toBeDefined();
      expect(bridgeCall.regressionAnalysis).toBeDefined();
    });
  });

  describe("success response", () => {
    it("returns success with plan details", async () => {
      const result = await toolHandler(createValidInput());

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.planId).toBe("plan-123");
      expect(parsed.filePath).toBe(".clive/plans/test-plan.md");
      expect(parsed.message).toBe("Test plan created");
    });

    it("includes input fields in response", async () => {
      const input = createValidInput();
      const result = await toolHandler(input);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.name).toBe(input.name);
      expect(parsed.overview).toBe(input.overview);
      expect(parsed.suites).toEqual(input.suites);
      expect(parsed.mockDependencies).toEqual(input.mockDependencies);
      expect(parsed.discoveredPatterns).toEqual(input.discoveredPatterns);
    });

    it("includes optional regression analysis in response", async () => {
      const regressionAnalysis = {
        relatedTestFiles: ["auth.test.ts"],
        testsRun: 10,
        passed: 10,
        failed: 0,
        failures: [],
        summary: "All tests passing",
      };

      const result = await toolHandler(
        createValidInput({ regressionAnalysis }),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.regressionAnalysis).toEqual(regressionAnalysis);
    });
  });

  describe("error handling", () => {
    it("handles bridge call error", async () => {
      mockBridge.call.mockRejectedValue(new Error("Bridge timeout"));

      const result = await toolHandler(createValidInput());

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Bridge timeout");
    });

    it("handles non-Error exceptions", async () => {
      mockBridge.call.mockRejectedValue("string error");

      const result = await toolHandler(createValidInput());

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Failed to propose test plan");
    });

    it("handles bridge returning failure", async () => {
      mockBridge.call.mockResolvedValue({
        success: false,
        planId: "",
        message: "Failed to create plan file",
      });

      const result = await toolHandler(createValidInput());

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Failed to create plan file");
    });
  });

  describe("complex suites", () => {
    it("handles multiple suites with different test types", async () => {
      const input = createValidInput({
        suites: [
          {
            id: "suite-1",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/unit.test.ts",
            sourceFiles: ["src/a.ts"],
          },
          {
            id: "suite-2",
            name: "Integration Tests",
            testType: "integration",
            targetFilePath: "src/__tests__/integration.test.ts",
            sourceFiles: ["src/b.ts", "src/c.ts"],
          },
          {
            id: "suite-3",
            name: "E2E Tests",
            testType: "e2e",
            targetFilePath: "e2e/test.spec.ts",
            sourceFiles: [],
          },
        ],
      });

      const result = await toolHandler(input);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.suites).toHaveLength(3);
    });

    it("handles complex mock dependencies", async () => {
      const input = createValidInput({
        mockDependencies: [
          {
            dependency: "database",
            existingMock: "src/__mocks__/db.ts",
            mockStrategy: "factory",
          },
          {
            dependency: "http-client",
            mockStrategy: "spy",
          },
          {
            dependency: "config",
            mockStrategy: "inline",
          },
        ],
      });

      const result = await toolHandler(input);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.mockDependencies).toHaveLength(3);
    });
  });
});
