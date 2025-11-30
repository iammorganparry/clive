import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      name: "remove-html-output",
      writeBundle(options, bundle) {
        // Remove HTML files and src directory since we generate HTML dynamically
        const fs = require("fs");
        const path = require("path");
        const outDir = options.dir || "dist/webview";

        // Remove HTML files from bundle
        for (const fileName in bundle) {
          if (fileName.endsWith(".html")) {
            delete bundle[fileName];
          }
        }

        // Clean up any HTML files and src directory that were created
        try {
          const htmlPath = path.join(outDir, "src", "webview", "index.html");
          if (fs.existsSync(htmlPath)) {
            fs.unlinkSync(htmlPath);
            // Remove empty directories
            const srcWebviewDir = path.join(outDir, "src", "webview");
            const srcDir = path.join(outDir, "src");
            if (fs.existsSync(srcWebviewDir)) {
              fs.rmdirSync(srcWebviewDir);
            }
            if (fs.existsSync(srcDir)) {
              fs.rmdirSync(srcDir);
            }
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      },
    },
  ],
  build: {
    outDir: "dist/webview",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/webview/index.html"),
      output: {
        entryFileNames: "webview.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "webview.css";
          }
          // Keep original name for other assets
          return assetInfo.name || "asset";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
