import { defineConfig } from "tsup";

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
    "src/badge.tsx",
    "src/toast.tsx",
    "src/components/blocks/index.ts",
    "src/components/ai-elements/plan.tsx",
    "src/components/ai-elements/conversation.tsx",
    "src/components/ai-elements/message.tsx",
    "src/components/ai-elements/prompt-input.tsx",
    "src/components/ai-elements/tool.tsx",
    "src/components/ai-elements/reasoning.tsx",
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
  // CSS is built separately by tailwindcss CLI via build:css script
});
