import type React from "react";

/**
 * Loading screen shown during app initialization.
 * Displayed while auth status and onboarding preferences are being loaded.
 */
export const InitializingScreen: React.FC = () => (
  <div className="flex items-center justify-center h-full w-full bg-background">
    <div className="flex flex-col items-center gap-4">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      <span className="text-sm text-muted-foreground">Loading...</span>
    </div>
  </div>
);
