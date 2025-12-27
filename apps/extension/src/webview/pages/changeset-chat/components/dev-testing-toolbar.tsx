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
import { Bug, CheckCircle, XCircle, List, RotateCcw } from "lucide-react";
import type { ChangesetChatEvent } from "../machines/changeset-chat-machine.js";
import {
  createMockPlan,
  createMockActiveQueue,
  createMockPassedSuiteQueue,
  createMockFailedSuiteQueue,
  createMockMixedQueue,
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
        currentSuiteId: null,
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
        currentSuiteId: queue[0]?.id || null,
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
        currentSuiteId: queue.find((s) => s.status === "in_progress")?.id || null,
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
        currentSuiteId: null,
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
        currentSuiteId: null,
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
        currentSuiteId: null,
        agentMode: "plan",
        hasCompletedAnalysis: false,
      },
    });
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-[150px] right-4 z-50">
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg bg-background border-2 border-primary/20 hover:border-primary/40"
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

          <DropdownMenuItem onClick={handleReset} variant="destructive">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset All
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

