import "@clive/ui/styles.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "../styles/globals.css";

import { ThemeProvider } from "~/components/theme-provider";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	title: "Clive",
	description: "Build with confidence",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<TRPCReactProvider>
			<html className={`${geist.variable}`} lang="en" suppressHydrationWarning>
				<body>
					<ThemeProvider>
						<TRPCReactProvider>{children}</TRPCReactProvider>
					</ThemeProvider>
				</body>
			</html>
		</TRPCReactProvider>
	);
}
