"use client";

import { ThemeProvider as UIThemeProvider } from "@clive/ui/theme";
import type React from "react";

export function ThemeProvider({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return <UIThemeProvider>{children}</UIThemeProvider>;
}
