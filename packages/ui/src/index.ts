import { cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: Parameters<typeof cx>) => twMerge(cx(inputs));

export type {
  DeviceAuthPendingProps,
  DeviceCodeEntryProps,
  Feature,
  FeatureListProps,
  LoadingScreenProps,
  ResultCardProps,
} from "./components/blocks";
export {
  DeviceAuthPending,
  DeviceCodeEntry,
  FeatureList,
  LoadingScreen,
  ResultCard,
} from "./components/blocks";

export {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "./input-otp";
export type { LoginFormProps } from "./login-form";
export { LoginForm } from "./login-form";
export type { ResolvedTheme, ThemeMode } from "./theme";
export {
  ThemeProvider,
  ThemeToggle,
  themeDetectorScript,
  useTheme,
} from "./theme";
