/**
 * Unit Tests for Regression Detection Section
 * Tests the regression detection section
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { regressionDetection } from "../regression-detection.js";
import type { BuildConfig } from "../../types.js";

describe("Regression Detection Section", () => {
  it("should return regression detection instructions", async () => {
    const config: BuildConfig = {
      workspaceRoot: "/test/workspace",
    };

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("<regression_detection>");
    expect(content).toContain("OPT-IN: Regression Detection for Related Tests");
  });

  it("should include instructions for finding related test files", async () => {
    const config: BuildConfig = {
      workspaceRoot: "/test/workspace",
    };

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("Step 1: Find Related Test Files");
    expect(content).toContain("find . -name");
    expect(content).toContain("grep -rl");
  });

  it("should include instructions for asking the user", async () => {
    const config: BuildConfig = {
      workspaceRoot: "/test/workspace",
    };

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("Step 2: Ask the User");
    expect(content).toContain("Would you like me to run these tests");
  });

  it("should include instructions for running related tests", async () => {
    const config: BuildConfig = {
      workspaceRoot: "/test/workspace",
    };

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("Step 3: Run Related Tests Only");
    expect(content).toContain("bashExecute");
    expect(content).toContain("180000ms");
    expect(content).toContain("npx vitest run");
    expect(content).toContain("npx jest");
  });

  it("should include instructions for classifying failures", async () => {
    const config: BuildConfig = {
      workspaceRoot: "/test/workspace",
    };

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("Step 4: Analyze and Classify Failures");
    expect(content).toContain("Expected Regression");
    expect(content).toContain("Unexpected Regression");
    expect(content).toContain("update_test");
    expect(content).toContain("investigate");
    expect(content).toContain("fix_code");
  });

  it("should include instructions for documenting in plan", async () => {
    const config: BuildConfig = {
      workspaceRoot: "/test/workspace",
    };

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("Step 5: Document in Plan");
    expect(content).toContain("regressionAnalysis");
    expect(content).toContain("relatedTestFiles");
    expect(content).toContain("testsRun");
    expect(content).toContain("passed");
    expect(content).toContain("failed");
  });

  it("should include instructions for skipping when no related tests found", async () => {
    const config: BuildConfig = {
      workspaceRoot: "/test/workspace",
    };

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("If No Related Tests Found or User Declines");
    expect(content).toContain("Skip regression detection entirely");
    expect(content).toContain("Do NOT include regressionAnalysis");
  });

  it("should work with minimal config", async () => {
    const config: BuildConfig = {};

    const content = await Effect.runPromise(regressionDetection(config));

    expect(content).toContain("<regression_detection>");
  });
});
