import "@clive/ui/styles.css";
import type { Metadata } from "next";
import Link from "next/link";
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
		<html className={`${geist.variable}`} lang="en" suppressHydrationWarning>
			<body>
				<ThemeProvider>
					<TRPCReactProvider>
						<nav className="border-b px-4 py-2">
							<div className="mx-auto flex max-w-7xl items-center gap-6">
								<Link href="/" className="font-bold">
									Clive
								</Link>
								<Link
									href="/memories"
									className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
								>
									Memories
								</Link>
							</div>
						</nav>
						{children}
					</TRPCReactProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
