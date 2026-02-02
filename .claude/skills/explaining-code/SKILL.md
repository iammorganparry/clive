---
name: explaining-code
description: Explains code with visual diagrams and analogies. Use when explaining how code works, teaching about a codebase, or when the user asks "how does this work?"
allowed-tools: Read, Glob, Grep
---

# Explaining Code

When explaining code, always include:

1. **Start with an analogy**: Compare the code to something from everyday life
2. **Draw a diagram**: Use ASCII art to show the flow, structure, or relationships
3. **Walk through the code**: Explain step-by-step what happens
4. **Highlight a gotcha**: What's a common mistake or misconception?

Keep explanations conversational. For complex concepts, use multiple analogies.

## Example Explanation

### The Code
```typescript
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
};
```

### The Explanation

**Analogy**: Think of this like an elevator. When someone presses a button, the elevator doesn't immediately move - it waits a moment to see if anyone else is coming. Only after a pause does it actually go.

**Diagram**:
```
User types: H → He → Hel → Hello
            │    │     │      │
            ▼    ▼     ▼      ▼
Timer:     [====X====X====X=====]──▶ "Hello" (only this fires!)
           start reset reset  complete
```

**Walkthrough**:
1. User types "H" - timer starts (500ms countdown)
2. User types "e" - old timer cancelled, new timer starts
3. User types "l", "l", "o" - same pattern
4. User stops typing - timer completes, value updates

**Gotcha**: The cleanup function `clearTimeout(timer)` is crucial! Without it, you'd get stale updates firing after new values arrive. This is React's way of saying "nevermind that old timer."

## Diagram Styles

Use these ASCII patterns for different concepts:

### Data Flow
```
Input ──▶ Process ──▶ Output
```

### State Machine
```
┌─────────┐  action   ┌─────────┐
│  Idle   │──────────▶│ Loading │
└─────────┘           └────┬────┘
     ▲                     │
     │      success        ▼
     └─────────────────────┘
```

### Component Tree
```
        App
       /   \
    Header  Main
            /  \
        Sidebar Content
```

### Timeline
```
t=0      t=100    t=200    t=300
 │         │        │        │
 ▼         ▼        ▼        ▼
[mount]  [fetch] [render] [cleanup]
```

### Dependency Graph
```
┌───────────┐
│  Service  │
└─────┬─────┘
      │ depends on
┌─────▼─────┐
│   Repo    │
└─────┬─────┘
      │ uses
┌─────▼─────┐
│ Database  │
└───────────┘
```
