export interface Session {
  id: string;
  name: string;
  planFile: string;
  isActive: boolean;
  iteration?: number;
  maxIterations?: number;
}

export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'complete' | 'blocked' | 'skipped';
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
