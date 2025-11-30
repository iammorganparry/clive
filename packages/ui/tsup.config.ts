import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/button.tsx",
    "src/card.tsx",
    "src/dropdown-menu.tsx",
    "src/field.tsx",
    "src/input.tsx",
    "src/label.tsx",
    "src/login-form.tsx",
    "src/separator.tsx",
    "src/theme.tsx",
    "src/toast.tsx",
  ],
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  treeshake: true,
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
