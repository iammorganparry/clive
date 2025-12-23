import { defineConfig } from "tsup";
import { copyFileSync } from "node:fs";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/avatar.tsx",
    "src/button.tsx",
    "src/card.tsx",
    "src/dropdown-menu.tsx",
    "src/field.tsx",
    "src/input.tsx",
    "src/label.tsx",
    "src/login-form.tsx",
    "src/separator.tsx",
    "src/switch.tsx",
    "src/task.tsx",
    "src/theme.tsx",
    "src/input-otp.tsx",
    "src/toast.tsx",
    "src/components/blocks/index.ts",
    "src/components/ai-elements/plan.tsx",
  ],
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  treeshake: true,
  publicDir: false,
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
  onSuccess: () => {
    // Copy CSS file to dist
    copyFileSync("src/styles.css", "dist/styles.css");
  },
});
