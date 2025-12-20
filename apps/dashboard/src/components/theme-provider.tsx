"use client";

import type React from "react";
import { ThemeProvider as UIThemeProvider } from "@clive/ui/theme";

export function ThemeProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <UIThemeProvider>{children}</UIThemeProvider>;
}
