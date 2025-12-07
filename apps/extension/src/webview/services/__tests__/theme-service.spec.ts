import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initializeTheme,
  updateTheme,
  getCurrentTheme,
  type ThemeInfo,
} from "../theme-service.js";

describe("ThemeService", () => {
  beforeEach(() => {
    // Reset DOM before each test
    document.documentElement.className = "";
    document.documentElement.style.cssText = "";
    document.body.style.cssText = "";
  });

  describe("getCurrentTheme", () => {
    it("should detect dark theme from dark background color", () => {
      // Mock getComputedStyle to return dark background
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            if (prop === "--vscode-editor-background") {
              return "rgb(30, 30, 30)"; // Dark background
            }
            if (prop === "--vscode-color-theme-kind") {
              return "";
            }
            return "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      const theme = getCurrentTheme();
      expect(theme.colorScheme).toBe("dark");

      mockGetComputedStyle.mockRestore();
    });

    it("should detect light theme from light background color", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            if (prop === "--vscode-editor-background") {
              return "rgb(255, 255, 255)"; // Light background
            }
            if (prop === "--vscode-color-theme-kind") {
              return "";
            }
            return "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      const theme = getCurrentTheme();
      expect(theme.colorScheme).toBe("light");

      mockGetComputedStyle.mockRestore();
    });

    it("should use --vscode-color-theme-kind when available", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            // Return a non-empty value that doesn't match rgb/hsl/# patterns
            // so it falls through to the theme-kind check
            if (prop === "--vscode-editor-background") {
              return "some-color-value"; // Not empty, but not rgb/hsl/#
            }
            if (prop === "--vscode-color-theme-kind") {
              return "dark";
            }
            return "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      const theme = getCurrentTheme();
      expect(theme.colorScheme).toBe("dark");

      mockGetComputedStyle.mockRestore();
    });

    it("should default to light theme when no variables are set", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (_prop: string) => {
            return "";
          },
          backgroundColor: "",
        } as CSSStyleDeclaration;
        return style;
      });

      const theme = getCurrentTheme();
      expect(theme.colorScheme).toBe("light");

      mockGetComputedStyle.mockRestore();
    });

    it("should detect dark theme from body background color as fallback", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            if (prop === "--vscode-editor-background") {
              return "";
            }
            return "";
          },
          backgroundColor: "rgb(20, 20, 20)", // Dark background
        } as CSSStyleDeclaration;
        return style;
      });

      const theme = getCurrentTheme();
      expect(theme.colorScheme).toBe("dark");

      mockGetComputedStyle.mockRestore();
    });
  });

  describe("initializeTheme", () => {
    it("should apply dark theme when themeInfo is provided", () => {
      const themeInfo: ThemeInfo = { colorScheme: "dark" };
      initializeTheme(themeInfo);

      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("should apply light theme when themeInfo is provided", () => {
      const themeInfo: ThemeInfo = { colorScheme: "light" };
      initializeTheme(themeInfo);

      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("should detect theme automatically when themeInfo is not provided", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            if (prop === "--vscode-editor-background") {
              return "rgb(30, 30, 30)";
            }
            if (prop === "--vscode-color-theme-kind") {
              return "";
            }
            return "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      initializeTheme();

      expect(document.documentElement.classList.contains("dark")).toBe(true);

      mockGetComputedStyle.mockRestore();
    });

    it("should map VS Code CSS variables to shadcn variables", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            const vars: Record<string, string> = {
              "--vscode-editor-background": "#1e1e1e",
              "--vscode-foreground": "#d4d4d4",
              "--vscode-button-background": "#0e639c",
              "--vscode-button-foreground": "#ffffff",
              "--vscode-input-background": "#3c3c3c",
              "--vscode-input-border": "#454545",
              "--vscode-panel-border": "#454545",
              "--vscode-descriptionForeground": "#858585",
              "--vscode-errorForeground": "#f48771",
              "--vscode-sideBar-background": "#252526",
            };
            return vars[prop] || "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      initializeTheme({ colorScheme: "dark" });

      expect(
        document.documentElement.style.getPropertyValue("--background"),
      ).toBe("#1e1e1e");
      expect(
        document.documentElement.style.getPropertyValue("--foreground"),
      ).toBe("#d4d4d4");
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
        "#0e639c",
      );
      expect(
        document.documentElement.style.getPropertyValue("--primary-foreground"),
      ).toBe("#ffffff");
      expect(document.documentElement.style.getPropertyValue("--input")).toBe(
        "#3c3c3c",
      );
      expect(document.documentElement.style.getPropertyValue("--border")).toBe(
        "#454545",
      );
      expect(
        document.documentElement.style.getPropertyValue("--muted-foreground"),
      ).toBe("#858585");
      expect(
        document.documentElement.style.getPropertyValue("--destructive"),
      ).toBe("#f48771");
      expect(document.documentElement.style.getPropertyValue("--muted")).toBe(
        "#252526",
      );

      mockGetComputedStyle.mockRestore();
    });

    it("should use panel-border as fallback when input-border is not available", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            const vars: Record<string, string> = {
              "--vscode-editor-background": "#1e1e1e",
              "--vscode-panel-border": "#454545",
            };
            return vars[prop] || "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      initializeTheme({ colorScheme: "dark" });

      expect(document.documentElement.style.getPropertyValue("--border")).toBe(
        "#454545",
      );
      expect(document.documentElement.style.getPropertyValue("--ring")).toBe(
        "#454545",
      );

      mockGetComputedStyle.mockRestore();
    });
  });

  describe("updateTheme", () => {
    it("should update theme from dark to light", () => {
      // Initialize with dark theme
      initializeTheme({ colorScheme: "dark" });
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      // Update to light theme
      updateTheme({ colorScheme: "light" });
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("should update theme from light to dark", () => {
      // Initialize with light theme
      initializeTheme({ colorScheme: "light" });
      expect(document.documentElement.classList.contains("dark")).toBe(false);

      // Update to dark theme
      updateTheme({ colorScheme: "dark" });
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("should remap CSS variables when theme is updated", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            const vars: Record<string, string> = {
              "--vscode-editor-background": "#ffffff",
              "--vscode-foreground": "#000000",
              "--vscode-button-background": "#007acc",
              "--vscode-button-foreground": "#ffffff",
            };
            return vars[prop] || "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      updateTheme({ colorScheme: "light" });

      expect(
        document.documentElement.style.getPropertyValue("--background"),
      ).toBe("#ffffff");
      expect(
        document.documentElement.style.getPropertyValue("--foreground"),
      ).toBe("#000000");

      mockGetComputedStyle.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle missing VS Code variables gracefully", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (_prop: string) => {
            return "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      expect(() => {
        initializeTheme({ colorScheme: "dark" });
      }).not.toThrow();

      mockGetComputedStyle.mockRestore();
    });

    it("should handle HSL color format", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            if (prop === "--vscode-editor-background") {
              return "hsl(0, 0%, 20%)"; // Dark color
            }
            return "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      const theme = getCurrentTheme();
      // HSL(0, 0%, 20%) should be detected as dark
      expect(theme.colorScheme).toBe("dark");

      mockGetComputedStyle.mockRestore();
    });

    it("should handle hex color format", () => {
      const mockGetComputedStyle = vi.spyOn(window, "getComputedStyle");
      mockGetComputedStyle.mockImplementation((_element) => {
        const style = {
          getPropertyValue: (prop: string) => {
            if (prop === "--vscode-editor-background") {
              return "#ffffff"; // Light color
            }
            return "";
          },
        } as CSSStyleDeclaration;
        return style;
      });

      const theme = getCurrentTheme();
      expect(theme.colorScheme).toBe("light");

      mockGetComputedStyle.mockRestore();
    });
  });
});
