import { describe, expect, beforeEach, it, vi } from "vitest";
import { Effect, Runtime, type Layer } from "effect";
import { SettingsService } from "../settings-service.js";
import type * as vscode from "vscode";
import { GlobalStateKeys } from "../../constants.js";
import { createMockSettingsServiceLayer } from "../../__tests__/mock-factories/service-mocks.js";

describe("SettingsService - Base Branch Methods", () => {
  const runtime = Runtime.defaultRuntime;
  let mockGlobalState: vscode.Memento;
  let settingsLayer: Layer.Layer<SettingsService>;

  beforeEach(() => {
    const mock = createMockSettingsServiceLayer();
    settingsLayer = mock.layer;
    mockGlobalState = mock.mockGlobalState;
  });

  it("should return null when no base branch is configured", async () => {
    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.getBaseBranch();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe(null);
    expect(mockGlobalState.get).toHaveBeenCalledWith(GlobalStateKeys.baseBranch);
  });

  it("should return configured base branch when set", async () => {
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setBaseBranch("develop");
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.getBaseBranch();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe("develop");
    expect(mockGlobalState.update).toHaveBeenCalledWith(
      GlobalStateKeys.baseBranch,
      "develop",
    );
  });

  it("should store custom branch with setBaseBranch", async () => {
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setBaseBranch("main");
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(mockGlobalState.update).toHaveBeenCalledWith(
      GlobalStateKeys.baseBranch,
      "main",
    );

    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.getBaseBranch();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe("main");
  });

  it("should clear to auto-detect when setBaseBranch called with null", async () => {
    // First set a custom branch
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setBaseBranch("develop");
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    // Clear to auto-detect
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setBaseBranch(null);
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(mockGlobalState.update).toHaveBeenCalledWith(
      GlobalStateKeys.baseBranch,
      null,
    );

    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.getBaseBranch();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe(null);
  });

  it("should overwrite existing base branch", async () => {
    // Set initial branch
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setBaseBranch("main");
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    // Change to different branch
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setBaseBranch("staging");
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.getBaseBranch();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe("staging");
    expect(result).not.toBe("main");
  });

  it("should handle storage errors in setBaseBranch", async () => {
    // Spy on update and make it fail
    vi.spyOn(mockGlobalState, "update").mockRejectedValueOnce(
      new Error("Storage failed"),
    );

    await expect(
      Effect.gen(function* () {
        const service = yield* SettingsService;
        yield* service.setBaseBranch("develop");
      }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime)),
    ).rejects.toThrow();
  });
});

describe("SettingsService - Onboarding Methods", () => {
  const runtime = Runtime.defaultRuntime;
  let mockGlobalState: vscode.Memento;
  let settingsLayer: Layer.Layer<SettingsService>;

  beforeEach(() => {
    const mock = createMockSettingsServiceLayer();
    settingsLayer = mock.layer;
    mockGlobalState = mock.mockGlobalState;
  });

  it("should return false when onboarding is not complete", async () => {
    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.isOnboardingComplete();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe(false);
    expect(mockGlobalState.get).toHaveBeenCalledWith(
      GlobalStateKeys.onboardingComplete,
    );
  });

  it("should return true when onboarding is complete", async () => {
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setOnboardingComplete(true);
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.isOnboardingComplete();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe(true);
  });

  it("should store onboarding completion status as true", async () => {
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setOnboardingComplete(true);
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(mockGlobalState.update).toHaveBeenCalledWith(
      GlobalStateKeys.onboardingComplete,
      true,
    );

    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.isOnboardingComplete();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe(true);
  });

  it("should store onboarding completion status as false", async () => {
    // First mark as complete
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setOnboardingComplete(true);
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    // Reset to incomplete
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setOnboardingComplete(false);
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(mockGlobalState.update).toHaveBeenCalledWith(
      GlobalStateKeys.onboardingComplete,
      false,
    );

    const result = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.isOnboardingComplete();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(result).toBe(false);
  });

  it("should handle storage errors in setOnboardingComplete", async () => {
    // Spy on update and make it fail
    vi.spyOn(mockGlobalState, "update").mockRejectedValueOnce(
      new Error("Storage failed"),
    );

    await expect(
      Effect.gen(function* () {
        const service = yield* SettingsService;
        yield* service.setOnboardingComplete(true);
      }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime)),
    ).rejects.toThrow();
  });

  it("should handle complete onboarding flow", async () => {
    // 1. Initially not complete
    const initialStatus = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.isOnboardingComplete();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(initialStatus).toBe(false);

    // 2. Mark as complete
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setOnboardingComplete(true);
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    // 3. Verify it's complete
    const completedStatus = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.isOnboardingComplete();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(completedStatus).toBe(true);

    // 4. Reset (e.g., for testing or re-onboarding)
    await Effect.gen(function* () {
      const service = yield* SettingsService;
      yield* service.setOnboardingComplete(false);
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    // 5. Verify it's not complete again
    const resetStatus = await Effect.gen(function* () {
      const service = yield* SettingsService;
      return yield* service.isOnboardingComplete();
    }).pipe(Effect.provide(settingsLayer), Runtime.runPromise(runtime));

    expect(resetStatus).toBe(false);
  });
});
