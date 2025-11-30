import React from 'react';

const Welcome: React.FC = () => {
	return (
		<div className="flex flex-col items-center justify-center min-h-[200px] text-center p-5">
			<h1 className="text-2xl font-bold mb-2.5 text-primary">
				Welcome to Clive
			</h1>
			<p className="text-foreground mb-2.5">
				Your AI-Powered Test Automation Writer
			</p>
			<p className="text-muted-foreground leading-relaxed">
				Get started by describing the test you want to create.
			</p>
		</div>
	);
};

export default Welcome;

