import type React from "react";

export interface Feature {
  id?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

export interface FeatureListProps {
  features: Feature[];
  className?: string;
}

/**
 * Feature list component for displaying feature bullet points with icons.
 * Used in onboarding and marketing contexts.
 */
export function FeatureList({ features, className }: FeatureListProps) {
  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      {features.map((feature, index) => (
        <div
          key={feature.id ?? `feature-${index}`}
          className="flex items-start gap-3"
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {feature.icon}
          </div>
          <div>
            <h3 className="font-medium text-sm">{feature.title}</h3>
            <p className="text-xs text-muted-foreground">
              {feature.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
