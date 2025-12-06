import { cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: Parameters<typeof cx>) => twMerge(cx(inputs));

export { LoginForm } from "./login-form";
export type { LoginFormProps } from "./login-form";

export {
  ThemeProvider,
  useTheme,
  ThemeToggle,
  themeDetectorScript,
} from "./theme";
export type { ThemeMode, ResolvedTheme } from "./theme";
