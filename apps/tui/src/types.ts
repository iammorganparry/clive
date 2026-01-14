export interface Session {
  id: string; // beads epic ID
  name: string; // formatted display name
  epicId: string; // beads epic ID (same as id)
  branch?: string; // git branch extracted from title
  isActive: boolean; // has in-progress tasks
  iteration?: number; // build iteration (from state files)
  maxIterations?: number;
}

export interface Task {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "complete" | "blocked" | "skipped";
  tier?: number;
  skill?: string;
  category?: string;
  target?: string;
}

export interface OutputLine {
  id: string;
  text: string;
  type:
    | "stdout"
    | "stderr"
    | "system"
    | "marker"
    | "tool_call"
    | "tool_result"
    | "user_input";
  timestamp: Date;
  toolName?: string; // For tool_call type
  indent?: number; // Indentation level (0, 1, 2)
}

export interface CommandContext {
  appendOutput: (text: string, type?: OutputLine["type"]) => void;
  setActiveSession: (id: string) => void;
  refreshSessions: () => void;
  refreshTasks: () => void;
  activeSession: Session | null;
  setIsRunning: (running: boolean) => void;
}

export type CommandHandler = (
  args: string[],
  ctx: CommandContext,
) => Promise<void>;
