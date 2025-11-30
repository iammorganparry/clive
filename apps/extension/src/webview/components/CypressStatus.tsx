import React from 'react';
import { Button } from 'extension/src/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'extension/src/components/ui/card';
import { Alert, AlertDescription } from 'extension/src/components/ui/alert';

interface PackageInfo {
	name: string;
	path: string;
	relativePath: string;
	hasCypressPackage: boolean;
	hasCypressConfig: boolean;
	isConfigured: boolean;
}

interface CypressStatusProps {
	status: {
		overallStatus: 'installed' | 'not_installed' | 'partial';
		packages: PackageInfo[];
		workspaceRoot: string;
	};
	onSetup: (targetDirectory?: string) => void;
	setupInProgress?: string;
	error?: string;
}

const CypressStatus: React.FC<CypressStatusProps> = ({
	status,
	onSetup,
	setupInProgress,
	error,
}) => {
	const { overallStatus, packages } = status;
	const isMonorepo = packages.length > 1;

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
				return 'text-destructive';
			default:
				return '';
		}
	};

	const getStatusText = () => {
		switch (overallStatus) {
			case 'installed':
				return 'Cypress is installed and configured';
			case 'partial':
				return 'Cypress is partially installed';
			case 'not_installed':
				return 'Cypress is not installed';
			default:
				return '';
		}
	};

	return (
		<div className="w-full p-4 space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Cypress Status</CardTitle>
					<CardDescription className="flex items-center gap-2">
						<span className={`text-xl ${getStatusColor(overallStatus)}`}>
							{getStatusIcon(overallStatus)}
						</span>
						<span>{getStatusText()}</span>
					</CardDescription>
				</CardHeader>
			</Card>

			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{overallStatus === 'not_installed' && !isMonorepo && (
				<div>
					<Button
						onClick={() => onSetup()}
						disabled={!!setupInProgress}
					>
						{setupInProgress ? 'Setting up Cypress...' : 'Setup Cypress'}
					</Button>
				</div>
			)}

			{isMonorepo && (
				<div className="space-y-4">
					<h3 className="text-sm font-semibold text-foreground">
						Packages ({packages.length})
					</h3>
					<div className="space-y-2">
						{packages.map((pkg) => (
							<Card key={pkg.path}>
								<CardHeader>
									<div className="flex items-center justify-between">
										<div>
											<CardTitle className="text-base">{pkg.name}</CardTitle>
											<CardDescription className="text-xs">
												{pkg.relativePath}
											</CardDescription>
										</div>
										<span
											className={`text-sm ${
												pkg.isConfigured
													? 'text-green-500'
													: 'text-destructive'
											}`}
										>
											{pkg.isConfigured
												? '✓ Configured'
												: '✗ Not configured'}
										</span>
									</div>
								</CardHeader>
								{!pkg.isConfigured && (
									<CardContent>
										<Button
											onClick={() => onSetup(pkg.path)}
											disabled={setupInProgress === pkg.path}
											size="sm"
										>
											{setupInProgress === pkg.path
												? 'Setting up...'
												: 'Setup Cypress'}
										</Button>
									</CardContent>
								)}
							</Card>
						))}
					</div>
				</div>
			)}

			{overallStatus === 'partial' && !isMonorepo && (
				<div>
					<Button
						onClick={() => onSetup()}
						disabled={!!setupInProgress}
					>
						{setupInProgress ? 'Setting up Cypress...' : 'Complete Setup'}
					</Button>
				</div>
			)}
		</div>
	);
};

export default CypressStatus;

