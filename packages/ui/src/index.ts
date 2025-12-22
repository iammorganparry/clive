import { cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: Parameters<typeof cx>) => twMerge(cx(inputs));

export { LoginForm } from "./login-form";
export type { LoginFormProps } from "./login-form";

export {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "./input-otp";

export {
  ThemeProvider,
  useTheme,
  ThemeToggle,
  themeDetectorScript,
} from "./theme";
export type { ThemeMode, ResolvedTheme } from "./theme";

export {
  DeviceCodeEntry,
  DeviceAuthPending,
  ResultCard,
  LoadingScreen,
  FeatureList,
} from "./components/blocks";
export type {
  DeviceCodeEntryProps,
  DeviceAuthPendingProps,
  ResultCardProps,
  LoadingScreenProps,
  FeatureListProps,
  Feature,
} from "./components/blocks";
