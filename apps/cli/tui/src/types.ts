export interface Session {
  id: string;           // beads epic ID
  name: string;         // formatted display name
  epicId: string;       // beads epic ID (same as id)
  branch?: string;      // git branch extracted from title
  isActive: boolean;    // has in-progress tasks
  iteration?: number;   // build iteration (from state files)
  maxIterations?: number;
}

export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'complete' | 'blocked' | 'skipped';
  tier?: number;
  skill?: string;
  category?: string;
  target?: string;
}

export interface OutputLine {
  id: string;
  text: string;
  type: 'stdout' | 'stderr' | 'system' | 'marker';
  timestamp: Date;
}

export interface CommandContext {
  appendOutput: (text: string, type?: OutputLine['type']) => void;
  setActiveSession: (id: string) => void;
  refreshSessions: () => void;
  refreshTasks: () => void;
}

export type CommandHandler = (args: string[], ctx: CommandContext) => Promise<void>;
