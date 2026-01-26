/**
 * Config Loader Tests
 *
 * Tests the unified config loading utility including:
 * - Environment file loading and saving
 * - Config file loading with priority (workspace > global)
 * - Linear config normalization (snake_case, camelCase)
 * - API key priority (env var > .env file > config file)
 * - Config merging and sensitive value extraction
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

// Mock os module
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// Store original process.env
const originalEnv = { ...process.env };

describe("config-loader", () => {
  // Import after mocking
  let loadConfig: typeof import("../config-loader").loadConfig;
  let saveConfig: typeof import("../config-loader").saveConfig;
  let loadEnvFile: typeof import("../config-loader").loadEnvFile;
  let saveEnvValue: typeof import("../config-loader").saveEnvValue;
  let getConfigDir: typeof import("../config-loader").getConfigDir;
  let getConfigPath: typeof import("../config-loader").getConfigPath;
  let validatePathTraversal: typeof import("../config-loader").validatePathTraversal;

  beforeEach(async () => {
    // Reset mocks
    vi.resetAllMocks();
    vi.resetModules();

    // Restore process.env
    process.env = { ...originalEnv };
    delete process.env.LINEAR_API_KEY;
    delete process.env.CLIVE_WORKER_TOKEN;
    delete process.env.CLIVE_WORKSPACE;

    // Re-import module to reset envLoaded state
    const module = await import("../config-loader");
    loadConfig = module.loadConfig;
    saveConfig = module.saveConfig;
    loadEnvFile = module.loadEnvFile;
    saveEnvValue = module.saveEnvValue;
    getConfigDir = module.getConfigDir;
    getConfigPath = module.getConfigPath;
    validatePathTraversal = module.validatePathTraversal;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("loadEnvFile", () => {
    it("should load environment variables from workspace .env file", async () => {
      const envContent = `LINEAR_API_KEY=lin_api_test123
CLIVE_WORKER_TOKEN=worker_token_456`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile("/workspace");

      expect(process.env.LINEAR_API_KEY).toBe("lin_api_test123");
      expect(process.env.CLIVE_WORKER_TOKEN).toBe("worker_token_456");
    });

    it("should handle quoted values", async () => {
      const envContent = `LINEAR_API_KEY="lin_api_quoted"
OTHER_KEY='single_quoted'`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile("/workspace");

      expect(process.env.LINEAR_API_KEY).toBe("lin_api_quoted");
      expect(process.env.OTHER_KEY).toBe("single_quoted");
    });

    it("should skip comments and empty lines", async () => {
      const envContent = `# This is a comment
LINEAR_API_KEY=test_key

# Another comment
`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile("/workspace");

      expect(process.env.LINEAR_API_KEY).toBe("test_key");
    });

    it("should handle values with equals signs", async () => {
      const envContent = `COMPLEX_VALUE=key=value=other`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile("/workspace");

      expect(process.env.COMPLEX_VALUE).toBe("key=value=other");
    });

    it("should not fail if .env file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => loadEnvFile("/workspace")).not.toThrow();
    });

    it("should only load from workspace, not global", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes("/workspace/.clive/.env");
      });
      vi.mocked(fs.readFileSync).mockReturnValue("WORKSPACE_KEY=workspace");

      loadEnvFile("/workspace");

      // Should only read workspace env file, not global
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync).toHaveBeenCalledWith("/workspace/.clive/.env", "utf-8");
      expect(process.env.WORKSPACE_KEY).toBe("workspace");
    });

    it("should not load from global even if workspace has no .env", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      loadEnvFile("/workspace");

      // Should not read any file since workspace .env doesn't exist
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it("should skip placeholder values", async () => {
      const envContent = `LINEAR_API_KEY=YOUR_API_KEY_HERE
REAL_KEY=actual_value`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile("/workspace");

      // Placeholder should be skipped
      expect(process.env.LINEAR_API_KEY).toBeUndefined();
      expect(process.env.REAL_KEY).toBe("actual_value");
    });
  });

  describe("saveEnvValue", () => {
    it("should create .env file in workspace if it does not exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p) === "/workspace/.clive") return true;
        return false;
      });

      saveEnvValue("NEW_KEY", "new_value", "/workspace");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/workspace/.clive/.env",
        "NEW_KEY=new_value",
        "utf-8"
      );
      expect(fs.chmodSync).toHaveBeenCalledWith("/workspace/.clive/.env", 0o600);
    });

    it("should update existing key in workspace .env file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        "EXISTING_KEY=old_value\nOTHER_KEY=keep"
      );

      saveEnvValue("EXISTING_KEY", "new_value", "/workspace");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/workspace/.clive/.env",
        "EXISTING_KEY=new_value\nOTHER_KEY=keep",
        "utf-8"
      );
    });

    it("should add new key to existing workspace .env file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("EXISTING_KEY=value");

      saveEnvValue("NEW_KEY", "new_value", "/workspace");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/workspace/.clive/.env",
        "EXISTING_KEY=value\nNEW_KEY=new_value",
        "utf-8"
      );
    });

    it("should create workspace .clive directory if it does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      saveEnvValue("KEY", "value", "/workspace");

      expect(fs.mkdirSync).toHaveBeenCalledWith("/workspace/.clive", {
        recursive: true,
      });
    });

    it("should set restrictive permissions on workspace .env file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("");

      saveEnvValue("KEY", "value", "/workspace");

      expect(fs.chmodSync).toHaveBeenCalledWith("/workspace/.clive/.env", 0o600);
    });

    it("should also set value in process.env", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("");

      saveEnvValue("MY_VAR", "my_value", "/workspace");

      expect(process.env.MY_VAR).toBe("my_value");
    });

    it("should use CLIVE_WORKSPACE env var when no workspace provided", async () => {
      process.env.CLIVE_WORKSPACE = "/env/workspace";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("");

      saveEnvValue("KEY", "value");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/env/workspace/.clive/.env",
        "KEY=value",
        "utf-8"
      );
    });
  });

  describe("loadConfig", () => {
    it("should return null if no workspace config exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = loadConfig("/workspace");

      expect(config).toBeNull();
    });

    it("should load workspace config only", async () => {
      const workspaceConfig = {
        issueTracker: "linear",
        linear: { apiKey: "workspace_key", teamID: "workspace_team" },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes("/workspace/.clive");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(workspaceConfig));

      const config = loadConfig("/workspace");

      expect(config?.issueTracker).toBe("linear");
      expect(config?.linear?.teamID).toBe("workspace_team");
    });

    it("should NOT fallback to global config when workspace config does not exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // Global config exists, but workspace config does not
        if (String(p).includes("/mock/home/.clive/config.json")) return true;
        return false;
      });

      const config = loadConfig("/workspace");

      // Should return null, not global config
      expect(config).toBeNull();
    });

    it("should use CLIVE_WORKSPACE env var for workspace path", async () => {
      process.env.CLIVE_WORKSPACE = "/custom/workspace";

      const workspaceConfig = {
        issueTracker: "beads",
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes("/custom/workspace/.clive/config.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(workspaceConfig)
      );

      const config = loadConfig();

      expect(config?.issueTracker).toBe("beads");
    });

    it("should normalize snake_case Linear config fields", async () => {
      const config = {
        issue_tracker: "linear",
        linear: { api_key: "snake_key", team_id: "snake_team" },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const result = loadConfig("/workspace");

      expect(result?.issueTracker).toBe("linear");
      expect(result?.linear?.apiKey).toBe("snake_key");
      expect(result?.linear?.teamID).toBe("snake_team");
    });

    it("should prioritize LINEAR_API_KEY env var over config file", async () => {
      process.env.LINEAR_API_KEY = "env_api_key";

      const config = {
        issueTracker: "linear",
        linear: { apiKey: "config_key", teamID: "team123" },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const result = loadConfig("/workspace");

      expect(result?.linear?.apiKey).toBe("env_api_key");
      expect(result?.linear?.teamID).toBe("team123");
    });

    it("should load API key from workspace .env file via loadEnvFile", async () => {
      const envContent = "LINEAR_API_KEY=env_file_key";
      const config = {
        issueTracker: "linear",
        linear: { teamID: "team123" },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes("/workspace/.clive");
      });
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).endsWith(".env")) return envContent;
        return JSON.stringify(config);
      });

      const result = loadConfig("/workspace");

      expect(result?.linear?.apiKey).toBe("env_file_key");
    });

    it("should preserve worker config", async () => {
      const config = {
        issueTracker: "linear",
        linear: { apiKey: "key", teamID: "team" },
        worker: {
          enabled: true,
          centralUrl: "wss://example.com",
          token: "token123",
          autoConnect: true,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const result = loadConfig("/workspace");

      expect(result?.worker?.enabled).toBe(true);
      expect(result?.worker?.centralUrl).toBe("wss://example.com");
      expect(result?.worker?.autoConnect).toBe(true);
    });

    it("should isolate config between different workspaces", async () => {
      // Test that loading from workspace A doesn't affect workspace B
      const workspaceAConfig = {
        issueTracker: "linear",
        linear: { apiKey: "key_a", teamID: "team_a" },
      };
      const workspaceBConfig = {
        issueTracker: "linear",
        linear: { apiKey: "key_b", teamID: "team_b" },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).includes("/workspace-a/")) return JSON.stringify(workspaceAConfig);
        if (String(p).includes("/workspace-b/")) return JSON.stringify(workspaceBConfig);
        return "{}";
      });

      const configA = loadConfig("/workspace-a");
      const configB = loadConfig("/workspace-b");

      expect(configA?.linear?.teamID).toBe("team_a");
      expect(configB?.linear?.teamID).toBe("team_b");
    });
  });

  describe("saveConfig", () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
    });

    it("should create workspace .clive directory if it does not exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p) === "/workspace/.clive") return false;
        return true;
      });

      saveConfig({ issueTracker: "beads" }, "/workspace");

      expect(fs.mkdirSync).toHaveBeenCalledWith("/workspace/.clive", {
        recursive: true,
      });
    });

    it("should extract API key to workspace .env file", async () => {
      saveConfig({
        issueTracker: "linear",
        linear: { apiKey: "secret_key", teamID: "team123" },
      }, "/workspace");

      // Check that saveEnvValue was effectively called (writes to workspace .env)
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith(".env")
      );
      expect(writeCall).toBeDefined();
      expect(String(writeCall?.[0])).toContain("/workspace/.clive/.env");
      expect(writeCall?.[1]).toContain("LINEAR_API_KEY=secret_key");

      // Check that config file does not contain apiKey
      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      expect(configCall).toBeDefined();
      expect(String(configCall?.[0])).toContain("/workspace/.clive/config.json");
      const savedConfig = JSON.parse(configCall?.[1] as string);
      expect(savedConfig.linear?.apiKey).toBeUndefined();
    });

    it("should extract worker token to workspace .env file", async () => {
      saveConfig({
        issueTracker: "linear",
        linear: { apiKey: "key", teamID: "team" },
        worker: {
          enabled: true,
          centralUrl: "wss://example.com",
          token: "secret_token",
        },
      }, "/workspace");

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith(".env")
      );
      expect(writeCall).toBeDefined();
      expect(String(writeCall?.[0])).toContain("/workspace/.clive/.env");

      // Check that config file does not contain token
      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      expect(configCall).toBeDefined();
      const savedConfig = JSON.parse(configCall?.[1] as string);
      expect(savedConfig.worker?.token).toBeUndefined();
      expect(savedConfig.worker?.enabled).toBe(true);
    });

    it("should merge with existing workspace config", async () => {
      const existingConfig = {
        issueTracker: "linear",
        linear: { teamID: "existing_team" },
        beads: { customField: "value" },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig));

      saveConfig({
        issueTracker: "linear",
        linear: { apiKey: "new_key", teamID: "new_team" },
      }, "/workspace");

      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      const savedConfig = JSON.parse(configCall?.[1] as string);

      expect(savedConfig.linear?.teamID).toBe("new_team");
      expect(savedConfig.beads?.customField).toBe("value");
    });

    it("should preserve existing linear config if not in new config", async () => {
      const existingConfig = {
        issueTracker: "linear",
        linear: { teamID: "existing_team" },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig));

      // Save config without linear field
      saveConfig({
        issueTracker: "beads",
      }, "/workspace");

      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      const savedConfig = JSON.parse(configCall?.[1] as string);

      expect(savedConfig.issueTracker).toBe("beads");
      expect(savedConfig.linear?.teamID).toBe("existing_team");
    });

    it("should use CLIVE_WORKSPACE env var when no workspace provided", async () => {
      process.env.CLIVE_WORKSPACE = "/env/workspace";

      saveConfig({ issueTracker: "beads" });

      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      expect(configCall).toBeDefined();
      expect(String(configCall?.[0])).toBe("/env/workspace/.clive/config.json");
    });
  });

  describe("getConfigDir", () => {
    it("should return global config directory path", () => {
      expect(getConfigDir()).toBe("/mock/home/.clive");
    });
  });

  describe("getConfigPath", () => {
    it("should return global config file path", () => {
      expect(getConfigPath()).toBe("/mock/home/.clive/config.json");
    });
  });

  describe("type consistency", () => {
    it("should return Config type from loadConfig", async () => {
      const config = {
        issueTracker: "linear" as const,
        linear: { apiKey: "key", teamID: "team" },
        worker: {
          enabled: true,
          centralUrl: "wss://example.com",
          token: "token",
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const result = loadConfig();

      // Type assertions - these will fail at compile time if types are wrong
      if (result) {
        const _issueTracker: "linear" | "beads" | null | undefined =
          result.issueTracker;
        const _apiKey: string | undefined = result.linear?.apiKey;
        const _teamID: string | undefined = result.linear?.teamID;
        const _enabled: boolean | undefined = result.worker?.enabled;
        const _url: string | undefined = result.worker?.centralUrl;
        const _autoConnect: boolean | undefined = result.worker?.autoConnect;

        expect(_issueTracker).toBe("linear");
        expect(_apiKey).toBeDefined();
        expect(_teamID).toBeDefined();
      }
    });
  });

  describe("validatePathTraversal (Security)", () => {
    it("should allow paths within base directory", () => {
      expect(validatePathTraversal("/home/user/project/.clive", "/home/user/project")).toBe(true);
      expect(validatePathTraversal("/home/user/project/.clive/config.json", "/home/user/project")).toBe(true);
      expect(validatePathTraversal("/home/user/project/subdir/file.txt", "/home/user/project")).toBe(true);
    });

    it("should allow path equal to base directory", () => {
      expect(validatePathTraversal("/home/user/project", "/home/user/project")).toBe(true);
    });

    it("should reject paths that escape base directory via ..", () => {
      expect(validatePathTraversal("/home/user/project/../../../etc/passwd", "/home/user/project")).toBe(false);
      expect(validatePathTraversal("/home/user/project/../other/file", "/home/user/project")).toBe(false);
      expect(validatePathTraversal("/home/user/project/subdir/../../etc/passwd", "/home/user/project")).toBe(false);
    });

    it("should reject absolute paths outside base directory", () => {
      expect(validatePathTraversal("/etc/passwd", "/home/user/project")).toBe(false);
      expect(validatePathTraversal("/home/other/project", "/home/user/project")).toBe(false);
      expect(validatePathTraversal("/var/log/syslog", "/home/user/project")).toBe(false);
    });

    it("should reject partial directory name matches", () => {
      // /home/user/project-evil should not match base /home/user/project
      expect(validatePathTraversal("/home/user/project-evil", "/home/user/project")).toBe(false);
      expect(validatePathTraversal("/home/user/project123", "/home/user/project")).toBe(false);
    });

    it("should handle normalized paths", () => {
      // These should resolve and be valid
      expect(validatePathTraversal("/home/user/project/./subdir", "/home/user/project")).toBe(true);
      expect(validatePathTraversal("/home/user/project/subdir/../subdir2", "/home/user/project")).toBe(true);
    });

    it("should handle Windows-style paths if on Windows", () => {
      // Note: This test is platform-dependent, but the function should handle both
      // On non-Windows, these will be normalized differently
      if (process.platform === "win32") {
        expect(validatePathTraversal("C:\\Users\\test\\project\\file", "C:\\Users\\test\\project")).toBe(true);
        expect(validatePathTraversal("C:\\Users\\test\\..\\other", "C:\\Users\\test\\project")).toBe(false);
      }
    });
  });
});
