import React from 'react';

interface PackageInfo {
	name: string;
	path: string;
	relativePath: string;
	hasPlaywrightPackage: boolean;
	hasPlaywrightConfig: boolean;
	isConfigured: boolean;
}

interface PlaywrightStatusProps {
	status: {
		overallStatus: 'installed' | 'not_installed' | 'partial';
		packages: PackageInfo[];
		workspaceRoot: string;
	};
	onSetup: (targetDirectory?: string) => void;
	setupInProgress?: string;
	error?: string;
}

const PlaywrightStatus: React.FC<PlaywrightStatusProps> = ({
	status,
	onSetup,
	setupInProgress,
	error,
}) => {
	const { overallStatus, packages } = status;
	const isMonorepo = packages.length > 1;
	const packagesWithoutPlaywright = packages.filter((p) => !p.isConfigured);

	const getStatusIcon = (status: string) => {
		switch (status) {
			case 'installed':
				return '✓';
			case 'partial':
				return '⚠';
			case 'not_installed':
				return '✗';
			default:
				return '';
		}
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case 'installed':
				return 'text-green-500';
			case 'partial':
				return 'text-yellow-500';
			case 'not_installed':
				return 'text-red-500';
			default:
				return '';
		}
	};

	return (
		<div className="w-full p-4">
			<div className="mb-4">
				<h2 className="text-lg font-semibold mb-2 text-vscode-foreground">
					Playwright Status
				</h2>
				<div className="flex items-center gap-2 mb-4">
					<span className={`text-xl ${getStatusColor(overallStatus)}`}>
						{getStatusIcon(overallStatus)}
					</span>
					<span className="text-vscode-foreground">
						{overallStatus === 'installed'
							? 'Playwright is installed and configured'
							: overallStatus === 'partial'
								? 'Playwright is partially installed'
								: 'Playwright is not installed'}
					</span>
				</div>
			</div>

			{error && (
				<div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-500 text-sm">
					{error}
				</div>
			)}

			{overallStatus === 'not_installed' && !isMonorepo && (
				<div className="mb-4">
					<button
						onClick={() => onSetup()}
						disabled={!!setupInProgress}
						className="px-4 py-2 bg-vscode-button-background text-vscode-button-foreground rounded hover:bg-vscode-button-hoverBackground disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{setupInProgress ? 'Setting up Playwright...' : 'Setup Playwright'}
					</button>
				</div>
			)}

			{isMonorepo && (
				<div className="mb-4">
					<h3 className="text-sm font-semibold mb-2 text-vscode-foreground">
						Packages ({packages.length})
					</h3>
					<div className="space-y-2">
						{packages.map((pkg) => (
							<div
								key={pkg.path}
								className="p-3 border border-vscode-panel-border rounded bg-vscode-editor-background"
							>
								<div className="flex items-center justify-between mb-2">
									<div>
										<div className="font-medium text-vscode-foreground">
											{pkg.name}
										</div>
										<div className="text-xs text-vscode-descriptionForeground">
											{pkg.relativePath}
										</div>
									</div>
									<div className="flex items-center gap-2">
										<span
											className={`text-sm ${pkg.isConfigured ? 'text-green-500' : 'text-red-500'}`}
										>
											{pkg.isConfigured ? '✓ Configured' : '✗ Not configured'}
										</span>
									</div>
								</div>
								{!pkg.isConfigured && (
									<button
										onClick={() => onSetup(pkg.path)}
										disabled={setupInProgress === pkg.path}
										className="mt-2 px-3 py-1 text-xs bg-vscode-button-background text-vscode-button-foreground rounded hover:bg-vscode-button-hoverBackground disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{setupInProgress === pkg.path
											? 'Setting up...'
											: 'Setup Playwright'}
									</button>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{overallStatus === 'partial' && !isMonorepo && (
				<div className="mb-4">
					<button
						onClick={() => onSetup()}
						disabled={!!setupInProgress}
						className="px-4 py-2 bg-vscode-button-background text-vscode-button-foreground rounded hover:bg-vscode-button-hoverBackground disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{setupInProgress ? 'Setting up Playwright...' : 'Complete Setup'}
					</button>
				</div>
			)}
		</div>
	);
};

export default PlaywrightStatus;

