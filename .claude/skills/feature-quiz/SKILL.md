---
name: feature-quiz
description: Quiz the user after implementing a feature to reinforce learning and retention. Generates 8-10 questions covering implementation details, architectural decisions, edge cases, usage patterns, and reasoning behind choices. Use this skill (1) immediately after completing a feature implementation, (2) when the user says they've finished a feature, (3) when the user explicitly requests /feature-quiz. Proactively offer to quiz after substantial code changes or feature completions.
---

# Feature Quiz

Generate a comprehensive quiz to reinforce understanding of a newly implemented feature.

## When to Trigger

Proactively offer this quiz when:
- A feature implementation is completed
- Significant code changes have been made
- The user indicates they've finished building something

## Quiz Generation Process

1. **Gather context** - Review conversation history and files modified during implementation
2. **Identify key learning points** across categories:
   - Implementation details (code patterns, functions, data flow)
   - Architectural decisions (why this approach vs alternatives)
   - Edge cases and error handling
   - Usage patterns and integration points
   - Trade-offs and reasoning

3. **Generate 8-10 questions** distributed as:
   - 2-3 implementation questions (specific code details)
   - 2 architecture questions (design decisions, patterns)
   - 2 edge case questions (error handling, boundaries)
   - 1-2 usage questions (how to use, extend, modify)
   - 1-2 "why" questions (reasoning behind decisions)

## Question Formats

Mix these formats:

- **Direct recall**: "What function handles X?"
- **Conceptual**: "Why did we use Y pattern instead of Z?"
- **Scenario-based**: "If a user tries to X, what happens?"
- **Code completion**: "What would you add to handle edge case X?"
- **Comparison**: "How does this differ from existing implementation of Y?"

## Quiz Flow

1. Present all questions numbered 1-10
2. Wait for user responses (all at once or one by one)
3. After receiving answers, provide:
   - Score (X/10 correct)
   - Corrections with explanations for wrong answers
   - Additional context for partial answers
   - Praise for insightful answers beyond expectations

## Scoring

- **Correct**: Full understanding demonstrated
- **Partial**: Right direction, missing key details
- **Incorrect**: Provide clear explanation

## Example Output

```
## Feature Quiz: [Feature Name]

Let's test your understanding of the [feature] we just implemented!

### Questions

1. [Implementation] What is the main entry point for this feature?

2. [Implementation] How does data flow from trigger to final action?

3. [Architecture] Why did we choose [pattern] instead of [alternative]?

4. [Architecture] What service/layer handles [core responsibility]?

5. [Edge Case] What happens if [input validation scenario]?

6. [Edge Case] How does the system handle [error condition]?

7. [Usage] How would you extend this to support [related use case]?

8. [Usage] What configuration affects this feature?

9. [Why] What problem does [implementation choice] solve?

10. [Why] What trade-offs did we accept?

---
Take your time! Answer as many as you can.
```

## After the Quiz

Summarize:
- Key concepts to remember
- Common pitfalls to avoid
- Related areas to explore

Offer to:
- Re-quiz on missed questions
- Deep-dive into any topic
- Create a reference note of key points
