export default function AuthLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center p-6">
			{children}
		</div>
	);
}
