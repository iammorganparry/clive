import type React from "react";
import { useState } from "react";
import { Button } from "@clive/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@clive/ui/dropdown-menu";
import { Bug, CheckCircle, XCircle, List, RotateCcw, Terminal, FileEdit, Search, Globe, Brain, Activity, AlertCircle } from "lucide-react";
import type { ChangesetChatEvent } from "../machines/changeset-chat-machine.js";
import {
  createMockPlan,
  createMockActiveQueue,
  createMockPassedSuiteQueue,
  createMockFailedSuiteQueue,
  createMockMixedQueue,
  createMockBashExecuteMessage,
  createMockBashExecutePendingApproval,
  createMockBashExecuteRejected,
  createMockWriteTestFileMessage,
  createMockWriteTestFilePendingApproval,
  createMockWriteTestFileRejected,
  createMockSearchKnowledgeMessage,
  createMockReplaceInFileMessage,
  createMockReplaceInFilePendingApproval,
  createMockReplaceInFileRejected,
  createMockWebSearchMessage,
  createMockReasoningState,
  createMockUsage,
  createMockError,
} from "../utils/mock-states.js";

interface DevTestingToolbarProps {
  send: (event: ChangesetChatEvent) => void;
}

export const DevTestingToolbar: React.FC<DevTestingToolbarProps> = ({ send }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleInjectPlan = () => {
    const planContent = createMockPlan();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        planContent,
        hasCompletedAnalysis: true,
        agentMode: "plan",
      },
    });
    setIsOpen(false);
  };

  const handleClearPlan = () => {
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        planContent: null,
      },
    });
    setIsOpen(false);
  };

  const handleEmptyQueue = () => {
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        testSuiteQueue: [],
        agentMode: "plan",
      },
    });
    setIsOpen(false);
  };

  const handleActiveQueue = () => {
    const queue = createMockActiveQueue();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        testSuiteQueue: queue,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleMixedQueue = () => {
    const queue = createMockMixedQueue();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        testSuiteQueue: queue,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleAllPassed = () => {
    const queue = createMockPassedSuiteQueue();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        testSuiteQueue: queue,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleSomeFailed = () => {
    const queue = createMockFailedSuiteQueue();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        testSuiteQueue: queue,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleReset = () => {
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        planContent: null,
        testSuiteQueue: [],
        agentMode: "plan",
        hasCompletedAnalysis: false,
      },
    });
    setIsOpen(false);
  };

  // Tool call handlers
  const handleBashExecute = () => {
    const message = createMockBashExecuteMessage();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
      },
    });
    setIsOpen(false);
  };

  const handleBashExecutePending = () => {
    const message = createMockBashExecutePendingApproval();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
      },
    });
    setIsOpen(false);
  };

  const handleBashExecuteRejected = () => {
    const message = createMockBashExecuteRejected();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
      },
    });
    setIsOpen(false);
  };

  const handleWriteTestFile = () => {
    const message = createMockWriteTestFileMessage();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleSearchKnowledge = () => {
    const message = createMockSearchKnowledgeMessage();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
      },
    });
    setIsOpen(false);
  };

  const handleReplaceInFile = () => {
    const message = createMockReplaceInFileMessage();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleWebSearch = () => {
    const message = createMockWebSearchMessage();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
      },
    });
    setIsOpen(false);
  };

  const handleWriteTestFilePending = () => {
    const message = createMockWriteTestFilePendingApproval();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleWriteTestFileRejected = () => {
    const message = createMockWriteTestFileRejected();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleReplaceInFilePending = () => {
    const message = createMockReplaceInFilePendingApproval();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  const handleReplaceInFileRejected = () => {
    const message = createMockReplaceInFileRejected();
    send({
      type: "DEV_INJECT_STATE",
      updates: {
        messages: [message],
        hasCompletedAnalysis: true,
        agentMode: "act",
      },
    });
    setIsOpen(false);
  };

  // State handlers
  const handleShowReasoning = () => {
    const reasoning = createMockReasoningState();
    send({
      type: "DEV_INJECT_STATE",
      updates: reasoning,
    });
    setIsOpen(false);
  };

  const handleShowUsage = () => {
    const usage = createMockUsage();
    send({
      type: "DEV_INJECT_STATE",
      updates: { usage },
    });
    setIsOpen(false);
  };

  const handleShowErrorSubscription = () => {
    const error = createMockError("subscription");
    send({
      type: "DEV_INJECT_STATE",
      updates: { error },
    });
    setIsOpen(false);
  };

  const handleShowErrorAnalysis = () => {
    const error = createMockError("analysis");
    send({
      type: "DEV_INJECT_STATE",
      updates: { error },
    });
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-[50px] right-4 z-50">
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg bg-primary z-50 border-2 border-primary/20 hover:border-primary/40"
            aria-label="Dev Testing Toolbar"
          >
            <Bug className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Dev Testing States</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Plan States
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleInjectPlan}>
              <List className="mr-2 h-4 w-4" />
              Show Plan
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleClearPlan}>
              <XCircle className="mr-2 h-4 w-4" />
              Clear Plan
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Queue States
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleEmptyQueue}>
              <List className="mr-2 h-4 w-4" />
              Empty Queue
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleActiveQueue}>
              <List className="mr-2 h-4 w-4" />
              Active Queue
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleMixedQueue}>
              <List className="mr-2 h-4 w-4" />
              Mixed Queue
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Test Results
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleAllPassed}>
              <CheckCircle className="mr-2 h-4 w-4" />
              All Passed
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSomeFailed}>
              <XCircle className="mr-2 h-4 w-4" />
              Some Failed
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Tool Calls
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleBashExecute}>
              <Terminal className="mr-2 h-4 w-4" />
              Bash Execute
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWriteTestFile}>
              <FileEdit className="mr-2 h-4 w-4" />
              Write Test File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSearchKnowledge}>
              <Search className="mr-2 h-4 w-4" />
              Search Knowledge
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleReplaceInFile}>
              <FileEdit className="mr-2 h-4 w-4" />
              Replace In File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWebSearch}>
              <Globe className="mr-2 h-4 w-4" />
              Web Search
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Terminal Approval States
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleBashExecutePending}>
              <Terminal className="mr-2 h-4 w-4 text-yellow-500" />
              Bash: Pending Approval
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBashExecuteRejected}>
              <XCircle className="mr-2 h-4 w-4 text-red-500" />
              Bash: Rejected
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Diff Approval States
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleWriteTestFilePending}>
              <FileEdit className="mr-2 h-4 w-4 text-yellow-500" />
              Write File: Pending Approval
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWriteTestFileRejected}>
              <XCircle className="mr-2 h-4 w-4 text-red-500" />
              Write File: Rejected
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleReplaceInFilePending}>
              <FileEdit className="mr-2 h-4 w-4 text-yellow-500" />
              Edit File: Pending Approval
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleReplaceInFileRejected}>
              <XCircle className="mr-2 h-4 w-4 text-red-500" />
              Edit File: Rejected
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              States
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleShowReasoning}>
              <Brain className="mr-2 h-4 w-4" />
              Show Reasoning
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleShowUsage}>
              <Activity className="mr-2 h-4 w-4" />
              Show Usage
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleShowErrorSubscription}>
              <AlertCircle className="mr-2 h-4 w-4" />
              Error: Subscription
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleShowErrorAnalysis}>
              <AlertCircle className="mr-2 h-4 w-4" />
              Error: Analysis
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleReset} variant="destructive">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset All
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

