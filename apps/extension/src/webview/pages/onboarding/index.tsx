import type React from "react";
import { useState } from "react";
import { Button } from "@clive/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { Search, Shield, Settings, Zap } from "lucide-react";
import { useRpc } from "../../rpc/provider.js";
import { useRouter } from "../../router/index.js";

interface FeatureItemProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const FeatureItem: React.FC<FeatureItemProps> = ({
  icon,
  title,
  description,
}) => (
  <div className="flex items-start gap-3">
    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
      {icon}
    </div>
    <div>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  </div>
);

export const OnboardingPage: React.FC = () => {
  const rpc = useRpc();
  const { send } = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const completeOnboardingMutation = rpc.config.completeOnboarding.useMutation({
    onSuccess: () => {
      // Send ONBOARDING_COMPLETE event to transition machine to ready state
      send({ type: "ONBOARDING_COMPLETE" });
    },
    onError: (error) => {
      console.error("Failed to complete onboarding:", error);
      setIsSubmitting(false);
    },
  });

  const handleEnableIndexing = () => {
    setIsSubmitting(true);
    completeOnboardingMutation.mutate({ enableIndexing: true });
  };

  const handleSkip = () => {
    setIsSubmitting(true);
    completeOnboardingMutation.mutate({ enableIndexing: false });
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/30">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-3">
            <Search className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Smart Code Understanding</CardTitle>
          <CardDescription className="text-sm">
            Enable codebase indexing to help Clive understand your project
            better
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Features */}
          <div className="space-y-4">
            <FeatureItem
              icon={<Zap className="w-4 h-4" />}
              title="Intelligent Code Search"
              description="Find relevant code using natural language queries"
            />
            <FeatureItem
              icon={<Search className="w-4 h-4" />}
              title="Contextual Assistance"
              description="Get more accurate suggestions based on your codebase"
            />
          </div>

          {/* Privacy Section */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="font-medium text-sm">
                Your Code Stays Private
              </span>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1 ml-6">
              <li>Code is processed locally and never shared</li>
              <li>Only semantic embeddings are stored securely</li>
              <li>You can disable this anytime in Settings</li>
            </ul>
          </div>

          {/* Settings reminder */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Settings className="w-3 h-3" />
            <span>You can change this later in Settings</span>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={handleEnableIndexing}
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Setting up..." : "Enable Smart Indexing"}
            </Button>
            <Button
              variant="ghost"
              onClick={handleSkip}
              disabled={isSubmitting}
              className="w-full text-muted-foreground"
            >
              Skip for now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
