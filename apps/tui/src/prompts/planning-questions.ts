/**
 * Structured question templates for planning agent interviews
 * Based on 4-phase Agile Project Manager interview framework
 * These help extract user stories, acceptance criteria, and Definition of Done
 */

export const PlanningQuestionTemplates = {
  // Phase 1: Problem Understanding
  problemContext: {
    question: "What problem are you trying to solve?",
    header: "Problem",
    options: [
      {
        label: "User pain point",
        description: "End users are experiencing friction or difficulty",
      },
      {
        label: "Developer productivity",
        description: "Development workflow needs improvement",
      },
      {
        label: "System limitation",
        description: "Current system can't handle a required capability",
      },
      {
        label: "Quality issue",
        description: "Code quality, performance, or maintainability concerns",
      },
    ],
    multiSelect: false,
  },

  userImpact: {
    question: "Who is impacted by this problem?",
    header: "Stakeholders",
    // Options should be dynamically generated based on context
  },

  desiredOutcome: {
    question: "What's the desired outcome after this work is complete?",
    header: "Outcome",
    // Free text or options based on problem type
  },

  urgency: {
    question: "Why is this important to address now?",
    header: "Urgency",
    options: [
      {
        label: "Blocking other work",
        description: "This is preventing progress on other tasks",
      },
      {
        label: "User-requested",
        description: "Users are asking for this capability",
      },
      {
        label: "Technical debt",
        description: "Accumulating debt that will get harder to fix",
      },
      {
        label: "Proactive improvement",
        description: "Good time to make this enhancement",
      },
    ],
    multiSelect: false,
  },

  // Phase 2: Scope & Boundaries
  scopeInclusion: {
    question: "What's IN scope for this work?",
    header: "In Scope",
    // Free text or checkboxes for capabilities
  },

  scopeExclusion: {
    question: "What's explicitly OUT of scope?",
    header: "Out of Scope",
    // Free text for exclusions
  },

  constraints: {
    question: "Are there any constraints we should know about?",
    header: "Constraints",
    options: [
      {
        label: "Time constraints",
        description: "Deadline or timeline limitations",
      },
      {
        label: "Technical constraints",
        description: "Must use specific technologies or patterns",
      },
      {
        label: "Resource constraints",
        description: "Limited availability or budget",
      },
      {
        label: "No major constraints",
        description: "Flexibility in approach and timeline",
      },
    ],
    multiSelect: true,
  },

  // Phase 3: User Stories & Acceptance
  userValue: {
    question: "What value does this deliver to users?",
    header: "Value",
    // Free text describing benefit
  },

  successCriteria: {
    question: "How will we know this is working correctly?",
    header: "Success",
    // Free text or structured acceptance criteria
  },

  edgeCases: {
    question: "What edge cases or error scenarios should we handle?",
    header: "Edge Cases",
    options: [
      {
        label: "Invalid input",
        description: "Handle malformed or unexpected user input",
      },
      {
        label: "Network failures",
        description: "Handle API or connectivity issues",
      },
      {
        label: "Missing data",
        description: "Handle null/undefined/missing values",
      },
      {
        label: "Permission errors",
        description: "Handle unauthorized access attempts",
      },
      {
        label: "Race conditions",
        description: "Handle concurrent operations",
      },
    ],
    multiSelect: true,
  },

  errorHandling: {
    question: "What should happen when things go wrong?",
    header: "Error UX",
    options: [
      {
        label: "Show user-friendly message",
        description: "Display clear error message to user",
      },
      {
        label: "Retry automatically",
        description: "Attempt to recover automatically",
      },
      {
        label: "Fallback behavior",
        description: "Gracefully degrade to alternative flow",
      },
      {
        label: "Log and alert",
        description: "Capture error for debugging, notify team",
      },
    ],
    multiSelect: true,
  },

  // Phase 4: Technical Context
  existingPatterns: {
    question: "Are there existing patterns we should follow?",
    header: "Patterns",
    // Options should be dynamically generated from codebase research
  },

  architecturalDecisions: {
    question: "Any architectural decisions already made for this area?",
    header: "Architecture",
    // Free text or options based on codebase
  },

  dependencies: {
    question: "What does this depend on or what depends on this?",
    header: "Dependencies",
    options: [
      {
        label: "External APIs",
        description: "Depends on third-party services",
      },
      {
        label: "Database changes",
        description: "Requires schema or migration work",
      },
      {
        label: "Other features",
        description: "Depends on other work being completed first",
      },
      {
        label: "No external dependencies",
        description: "Can be implemented independently",
      },
    ],
    multiSelect: true,
  },

  risks: {
    question: "What could go wrong or complicate this work?",
    header: "Risks",
    options: [
      {
        label: "Breaking changes",
        description: "Could break existing functionality",
      },
      {
        label: "Performance impact",
        description: "Could affect system performance",
      },
      {
        label: "Data migration needed",
        description: "Requires migrating existing data",
      },
      {
        label: "Complex integration",
        description: "Integration with other systems is complex",
      },
      {
        label: "Low risk",
        description: "Well-understood, isolated changes",
      },
    ],
    multiSelect: true,
  },

  // Definition of Done helpers
  testingRequirements: {
    question: "What testing is required for this work?",
    header: "Testing",
    options: [
      {
        label: "Unit tests (Recommended)",
        description: "Test individual functions and components",
      },
      {
        label: "Integration tests",
        description: "Test interactions between components",
      },
      {
        label: "E2E tests",
        description: "Test complete user workflows",
      },
      {
        label: "Manual testing only",
        description: "Verify manually, no automated tests needed",
      },
    ],
    multiSelect: true,
  },

  documentationNeeds: {
    question: "What documentation needs to be updated?",
    header: "Docs",
    options: [
      {
        label: "API documentation",
        description: "Update API docs for new endpoints or changes",
      },
      {
        label: "User guide",
        description: "Update user-facing documentation",
      },
      {
        label: "Code comments",
        description: "Add inline documentation for complex logic",
      },
      {
        label: "README updates",
        description: "Update project README",
      },
      {
        label: "No documentation needed",
        description: "Changes are self-explanatory",
      },
    ],
    multiSelect: true,
  },
} as const;

/**
 * 4-Phase Interview Framework for Agile Project Manager
 * Aligns with the structure in plan.md
 */
export const InterviewPhases = {
  phase1_problemUnderstanding: {
    name: "Problem Understanding",
    description: "Understand the problem, impact, and desired outcome",
    recommendedQuestions: 2 - 4,
    questions: [
      "What problem are you trying to solve?",
      "Who is impacted by this problem?",
      "What's the desired outcome after this work is complete?",
      "Why is this important to address now?",
    ],
  },

  phase2_scopeBoundaries: {
    name: "Scope & Boundaries",
    description: "Define what's in scope, out of scope, and constraints",
    recommendedQuestions: 2 - 3,
    questions: [
      "What's IN scope for this work?",
      "What's explicitly OUT of scope?",
      "Are there any constraints we should know about (time, technical, resource)?",
    ],
  },

  phase3_userStoriesAcceptance: {
    name: "User Stories & Acceptance",
    description: "Define success criteria and edge cases",
    recommendedQuestions: 3 - 5,
    questions: [
      "What value does this deliver to users?",
      "How will we know this is working correctly?",
      "What edge cases or error scenarios should we handle?",
      "What should happen when things go wrong?",
      "Are there any specific acceptance criteria you have in mind?",
    ],
  },

  phase4_technicalContext: {
    name: "Technical Context",
    description:
      "Understand existing patterns, decisions, dependencies, and risks",
    recommendedQuestions: 1 - 3,
    questions: [
      "Are there existing patterns in the codebase we should follow?",
      "Any architectural decisions already made for this area?",
      "What does this depend on or what depends on this?",
      "What could go wrong or complicate this work?",
    ],
  },
} as const;

/**
 * User Story Generation Helpers
 */
export const UserStoryTemplates = {
  basic: "As a {role}, I want {capability}, so that {benefit}",

  examples: [
    {
      role: "developer",
      capability: "see type errors in real-time",
      benefit: "I can catch bugs before running the code",
      acceptanceCriteria: [
        "Type errors appear in editor within 1 second",
        "Error messages are clear and actionable",
        "Errors disappear when fixed",
      ],
    },
    {
      role: "user",
      capability: "export my data as CSV",
      benefit: "I can analyze it in Excel",
      acceptanceCriteria: [
        "Export button appears on dashboard",
        "Clicking button downloads CSV file",
        "CSV contains all user data in readable format",
        "Export completes within 5 seconds",
      ],
    },
  ],
};

/**
 * Acceptance Criteria Guidelines
 */
export const AcceptanceCriteriaGuidelines = {
  characteristics: [
    "Testable - Can verify it's working",
    "Specific - Clear and unambiguous",
    "Measurable - Can determine pass/fail",
    "User-focused - Describes behavior from user perspective",
  ],

  goodExamples: [
    "User sees error message when login fails",
    "Search returns results within 2 seconds",
    "Form validation shows inline errors",
    "User can export data as CSV",
  ],

  badExamples: [
    "Code is well-structured", // Not testable
    "System works correctly", // Not specific
    "Performance is good", // Not measurable
    "OAuth middleware is implemented", // Implementation-focused, not user-focused
  ],
};

/**
 * Definition of Done Standards
 */
export const DefinitionOfDoneStandards = {
  standard: [
    "All acceptance criteria met and verified",
    "Unit tests written and passing (where applicable)",
    "Integration tests written and passing (where applicable)",
    "Code reviewed",
    "Documentation updated",
    "No linting errors",
    "No type errors",
    "Build succeeds",
  ],

  taskSpecific: {
    feature: [
      "All acceptance criteria met",
      "New functionality tested",
      "Error handling implemented",
      "User-facing changes documented",
    ],
    bugfix: [
      "Bug no longer reproducible",
      "Regression test added",
      "Root cause addressed",
      "All existing tests still pass",
    ],
    refactor: [
      "Code structure improved",
      "All existing tests still pass",
      "No behavior changes",
      "Performance not degraded",
    ],
  },
};
