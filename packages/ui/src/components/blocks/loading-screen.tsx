export interface LoadingScreenProps {
  message?: string;
  className?: string;
}

/**
 * Full-screen loading indicator for app initialization.
 */
export function LoadingScreen({
  message = "Loading...",
  className,
}: LoadingScreenProps) {
  return (
    <div
      className={`flex items-center justify-center h-full w-full bg-background ${className ?? ""}`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        <span className="text-sm text-muted-foreground">{message}</span>
      </div>
    </div>
  );
}
