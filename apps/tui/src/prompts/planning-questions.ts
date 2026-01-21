/**
 * Structured question templates for planning agent interviews
 * These are examples the agent can adapt based on the specific task
 */

export const PlanningQuestionTemplates = {
  scopeClarification: {
    question: "Let's clarify the scope of this task. Which aspects should be included?",
    header: "Scope",
    options: [
      {
        label: "Core functionality only",
        description: "Implement just the essential features"
      },
      {
        label: "Core + error handling",
        description: "Include comprehensive error handling"
      },
      {
        label: "Full implementation",
        description: "Include all features, error handling, and edge cases"
      }
    ],
    multiSelect: false
  },

  technicalApproach: {
    question: "What technical approach should we take?",
    header: "Approach",
    // Options should be dynamically generated based on codebase exploration
  },

  testingStrategy: {
    question: "What level of testing is needed?",
    header: "Testing",
    options: [
      {
        label: "Unit tests only",
        description: "Test individual functions and components"
      },
      {
        label: "Unit + integration tests",
        description: "Test both units and their interactions"
      },
      {
        label: "Comprehensive test coverage",
        description: "Unit, integration, and E2E tests"
      }
    ],
    multiSelect: false
  },

  architecturePattern: {
    question: "Which architectural pattern should we follow?",
    header: "Architecture",
    // Options should match existing patterns found in codebase
  },

  prioritization: {
    question: "What should we prioritize in this implementation?",
    header: "Priorities",
    options: [
      {
        label: "Speed of delivery",
        description: "Get it working quickly, refine later"
      },
      {
        label: "Code quality",
        description: "Focus on clean, maintainable code"
      },
      {
        label: "Performance",
        description: "Optimize for speed and efficiency"
      },
      {
        label: "Flexibility",
        description: "Make it easy to extend and modify"
      }
    ],
    multiSelect: true // Can select multiple priorities
  }
} as const;

export const InterviewPhases = {
  understanding: {
    name: "Understanding Your Request",
    questions: [
      "Can you describe in your own words what you want to accomplish?",
      "What problem are you trying to solve?",
      "Are there any existing examples or references you'd like me to follow?"
    ]
  },

  constraints: {
    name: "Identifying Constraints",
    questions: [
      "Are there any technical constraints I should be aware of?",
      "What are the performance requirements?",
      "Are there any compatibility concerns?",
      "What's the timeline for this work?"
    ]
  },

  integration: {
    name: "Understanding Integration Points",
    questions: [
      "What other systems or components will this integrate with?",
      "Are there any APIs or external services involved?",
      "What data flows need to be maintained?",
      "Are there any authentication or authorization considerations?"
    ]
  },

  validation: {
    name: "Defining Success Criteria",
    questions: [
      "How will you know this is working correctly?",
      "What are the key acceptance criteria?",
      "What edge cases should we handle?",
      "What should happen when things go wrong?"
    ]
  }
} as const;
