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
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("loadEnvFile", () => {
    it("should load environment variables from .env file", async () => {
      const envContent = `LINEAR_API_KEY=lin_api_test123
CLIVE_WORKER_TOKEN=worker_token_456`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile();

      expect(process.env.LINEAR_API_KEY).toBe("lin_api_test123");
      expect(process.env.CLIVE_WORKER_TOKEN).toBe("worker_token_456");
    });

    it("should handle quoted values", async () => {
      const envContent = `LINEAR_API_KEY="lin_api_quoted"
OTHER_KEY='single_quoted'`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile();

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

      loadEnvFile();

      expect(process.env.LINEAR_API_KEY).toBe("test_key");
    });

    it("should handle values with equals signs", async () => {
      const envContent = `COMPLEX_VALUE=key=value=other`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(envContent);

      loadEnvFile();

      expect(process.env.COMPLEX_VALUE).toBe("key=value=other");
    });

    it("should not fail if .env file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => loadEnvFile()).not.toThrow();
    });

    it("should load both global and workspace env files", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).includes("/mock/home/.clive/.env")) return "GLOBAL_KEY=global";
        if (String(p).includes("/workspace/.clive/.env")) return "WORKSPACE_KEY=workspace";
        return "";
      });

      loadEnvFile("/workspace");

      // Should read both global and workspace env files
      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(process.env.GLOBAL_KEY).toBe("global");
      expect(process.env.WORKSPACE_KEY).toBe("workspace");
    });

    it("should prioritize workspace env over global env for same key", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).includes("/mock/home/.clive/.env")) return "LINEAR_API_KEY=global_key";
        if (String(p).includes("/workspace/.clive/.env")) return "LINEAR_API_KEY=workspace_key";
        return "";
      });

      loadEnvFile("/workspace");

      // Workspace key should take priority
      expect(process.env.LINEAR_API_KEY).toBe("workspace_key");
    });
  });

  describe("saveEnvValue", () => {
    it("should create .env file if it does not exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === "/mock/home/.clive") return true;
        return false;
      });

      saveEnvValue("NEW_KEY", "new_value");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/mock/home/.clive/.env",
        "NEW_KEY=new_value",
        "utf-8"
      );
      expect(fs.chmodSync).toHaveBeenCalledWith("/mock/home/.clive/.env", 0o600);
    });

    it("should update existing key in .env file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        "EXISTING_KEY=old_value\nOTHER_KEY=keep"
      );

      saveEnvValue("EXISTING_KEY", "new_value");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/mock/home/.clive/.env",
        "EXISTING_KEY=new_value\nOTHER_KEY=keep",
        "utf-8"
      );
    });

    it("should add new key to existing .env file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("EXISTING_KEY=value");

      saveEnvValue("NEW_KEY", "new_value");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/mock/home/.clive/.env",
        "EXISTING_KEY=value\nNEW_KEY=new_value",
        "utf-8"
      );
    });

    it("should create config directory if it does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      saveEnvValue("KEY", "value");

      expect(fs.mkdirSync).toHaveBeenCalledWith("/mock/home/.clive", {
        recursive: true,
      });
    });

    it("should set restrictive permissions on .env file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("");

      saveEnvValue("KEY", "value");

      expect(fs.chmodSync).toHaveBeenCalledWith("/mock/home/.clive/.env", 0o600);
    });

    it("should also set value in process.env", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("");

      saveEnvValue("MY_VAR", "my_value");

      expect(process.env.MY_VAR).toBe("my_value");
    });
  });

  describe("loadConfig", () => {
    it("should return null if no config exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = loadConfig();

      expect(config).toBeNull();
    });

    it("should load global config when workspace config does not exist", async () => {
      const globalConfig = {
        issueTracker: "linear",
        linear: { apiKey: "global_key", teamID: "team123" },
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes("/.clive/config.json")) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(globalConfig));

      const config = loadConfig();

      expect(config?.issueTracker).toBe("linear");
      expect(config?.linear?.teamID).toBe("team123");
    });

    it("should prefer workspace config over global config", async () => {
      const workspaceConfig = {
        issueTracker: "linear",
        linear: { apiKey: "workspace_key", teamID: "workspace_team" },
      };
      const globalConfig = {
        issueTracker: "linear",
        linear: { apiKey: "global_key", teamID: "global_team" },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).includes(process.cwd())) {
          return JSON.stringify(workspaceConfig);
        }
        return JSON.stringify(globalConfig);
      });

      const config = loadConfig();

      expect(config?.linear?.teamID).toBe("workspace_team");
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

      const result = loadConfig();

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

      const result = loadConfig();

      expect(result?.linear?.apiKey).toBe("env_api_key");
      expect(result?.linear?.teamID).toBe("team123");
    });

    it("should load API key from .env file via loadEnvFile", async () => {
      const envContent = "LINEAR_API_KEY=env_file_key";
      const config = {
        issueTracker: "linear",
        linear: { teamID: "team123" },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).endsWith(".env")) return envContent;
        return JSON.stringify(config);
      });

      const result = loadConfig();

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

      const result = loadConfig();

      expect(result?.worker?.enabled).toBe(true);
      expect(result?.worker?.centralUrl).toBe("wss://example.com");
      expect(result?.worker?.autoConnect).toBe(true);
    });
  });

  describe("saveConfig", () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
    });

    it("should create config directory if it does not exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p) === "/mock/home/.clive") return false;
        return true;
      });

      saveConfig({ issueTracker: "beads" });

      expect(fs.mkdirSync).toHaveBeenCalledWith("/mock/home/.clive", {
        recursive: true,
      });
    });

    it("should extract API key to .env file", async () => {
      saveConfig({
        issueTracker: "linear",
        linear: { apiKey: "secret_key", teamID: "team123" },
      });

      // Check that saveEnvValue was effectively called
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith(".env")
      );
      expect(writeCall).toBeDefined();
      expect(writeCall?.[1]).toContain("LINEAR_API_KEY=secret_key");

      // Check that config file does not contain apiKey
      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      expect(configCall).toBeDefined();
      const savedConfig = JSON.parse(configCall?.[1] as string);
      expect(savedConfig.linear?.apiKey).toBeUndefined();
    });

    it("should extract worker token to .env file", async () => {
      saveConfig({
        issueTracker: "linear",
        linear: { apiKey: "key", teamID: "team" },
        worker: {
          enabled: true,
          centralUrl: "wss://example.com",
          token: "secret_token",
        },
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith(".env")
      );
      expect(writeCall).toBeDefined();

      // Check that config file does not contain token
      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      expect(configCall).toBeDefined();
      const savedConfig = JSON.parse(configCall?.[1] as string);
      expect(savedConfig.worker?.token).toBeUndefined();
      expect(savedConfig.worker?.enabled).toBe(true);
    });

    it("should merge with existing config", async () => {
      const existingConfig = {
        issueTracker: "linear",
        linear: { teamID: "existing_team" },
        beads: { customField: "value" },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig));

      saveConfig({
        issueTracker: "linear",
        linear: { apiKey: "new_key", teamID: "new_team" },
      });

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
      });

      const configCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) =>
        String(call[0]).endsWith("config.json")
      );
      const savedConfig = JSON.parse(configCall?.[1] as string);

      expect(savedConfig.issueTracker).toBe("beads");
      expect(savedConfig.linear?.teamID).toBe("existing_team");
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
});
