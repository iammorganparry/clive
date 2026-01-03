import type React from "react";
import { AiProviderForm } from "./components/ai-provider-form.js";
import { KnowledgeBaseCard } from "./components/knowledge-base-card.js";
import { BaseBranchForm } from "./components/base-branch-form.js";
import { TerminalCommandApprovalForm } from "./components/terminal-command-approval-form.js";

export const SettingsPage: React.FC = () => {
  return (
    <div className="w-full h-full p-4 space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your AI provider and preferences
        </p>
      </div>

      <AiProviderForm />

      <BaseBranchForm />

      <TerminalCommandApprovalForm />

      <KnowledgeBaseCard />
    </div>
  );
};
