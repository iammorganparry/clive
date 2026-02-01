export const MEMORY_TYPE_COLORS: Record<string, string> = {
  WORKING_SOLUTION: "bg-success/20 text-success border-success/30",
  GOTCHA: "bg-destructive/20 text-destructive border-destructive/30",
  PATTERN: "bg-info/20 text-info border-info/30",
  DECISION: "bg-warning/20 text-warning border-warning/30",
  FAILURE: "bg-destructive/20 text-destructive border-destructive/30",
  PREFERENCE: "bg-primary/20 text-primary border-primary/30",
  CONTEXT: "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30",
  SKILL_HINT: "bg-info/20 text-info border-info/30",
};

export const MEMORY_TYPE_LABELS: Record<string, string> = {
  WORKING_SOLUTION: "Working Solution",
  GOTCHA: "Gotcha",
  PATTERN: "Pattern",
  DECISION: "Decision",
  FAILURE: "Failure",
  PREFERENCE: "Preference",
  CONTEXT: "Context",
  SKILL_HINT: "Skill Hint",
};

export const MEMORY_TYPES = [
  "WORKING_SOLUTION",
  "GOTCHA",
  "PATTERN",
  "DECISION",
  "FAILURE",
  "PREFERENCE",
  "CONTEXT",
  "SKILL_HINT",
] as const;

export const TIERS = ["short", "long"] as const;

export const SEARCH_MODES = ["hybrid", "vector", "bm25"] as const;
