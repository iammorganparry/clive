# TypeScript TUI Status

## Current State: BLOCKED on Bun FFI Issue

### ✅ Working

- **OpenTUI/React Setup**: Basic OpenTUI apps work perfectly with Bun
  - Test: `bun run src/test-minimal.tsx` ✅
  - Test: `bun run src/test-app-import.tsx` ✅
- **Effect-TS Service Layer**: Properly configured with correct patterns
  - BeadsService, LinearService, TaskService use proper Effect patterns
  - Fixed Data.TaggedError for error types
  - Removed improper `.bind(this)` patterns from Effect.gen
- **TypeScript Configuration**: Aligned with OpenTUI best practices
  - module: "Preserve", noEmit: true, bundler mode
- **Package Configuration**: No build step needed (noEmit: true)
- **React Query Integration**: Configured for TUI data fetching
- **XState v5**: State machine properly configured

###  ❌ Blocked

**Main App Crashes** (`src/main.tsx` + `src/App.tsx`):
- **Error**: Bun FFI Segmentation fault at address 0x10
- **Root Cause**: Unknown - something in the full app imports causes Bun FFI crash
- **Evidence**: Simple OpenTUI apps work, but full app with hooks/components crashes
- **Bun Versions Tested**:
  - 1.1.18: ❌ Crashes
  - 1.3.6: ❌ Crashes

### 🔍 Investigation Needed

Likely culprits causing FFI crash:
1. **XState import** - Large state machine library
2. **React Query** - QueryClient initialization
3. **Deep component tree** - Something in Header/OutputPanel/InputBar
4. **Effect Runtime** - TaskService runtime initialization
5. **File system operations** - Config loading in hooks

### Next Steps

**Option 1: Isolate the Crash**
1. Start with test-app-import.tsx (works)
2. Gradually add imports from App.tsx until crash occurs
3. Identify the specific module causing FFI issues
4. Find workaround or alternative

**Option 2: Alternative Runtime**
- Node.js with `tsx`: Blocked by .scm file extension error
- Deno: Untested
- Native Node ESM: Untested

**Option 3: Alternative TUI Framework**
- Ink (React for CLIs) - More mature, widely used
- Blessed/neo-blessed - Lower level but stable
- Pastel (Ink + Ink components) - Modern alternative

## Architecture Reference

Based on working OpenTUI reference: `/Users/morganparry/repos/my-test`

```json
{
  "type": "module",
  "module": "src/index.tsx",
  "scripts": {
    "dev": "bun run --watch src/index.tsx"
  },
  "dependencies": {
    "@opentui/core": "^0.1.74",
    "@opentui/react": "^0.1.74",
    "react": "^19.2.3"
  }
}
```

**Key Findings**:
- Simple OpenTUI apps (just React + OpenTUI) work perfectly with Bun
- Adding complex dependencies (XState, React Query, Effect services) triggers FFI crash
- Issue is not with OpenTUI itself, but with dependency interactions

## Test Commands

```bash
# Working tests
bun run src/test-minimal.tsx      # ✅ Simple hello world
bun run src/test-app-import.tsx   # ✅ Logs + simple component

# Crashing test
bun run src/main.tsx               # ❌ Full app with all dependencies

# Reference implementation (works)
cd ../my-test && bun run dev       # ✅ OpenTUI starter
```

## Migration Plan Status

- [x] Phase 0: Refactor extension code to shared package
- [x] Phase 1: Environment setup & hello world
- [x] Phase 2: Type definitions & data models
- [x] Phase 3: Backend service with ClaudeCliService
- [x] Phase 4: Style system (One Dark Pro theme)
- [x] Phase 5: Component architecture (partial - blocked by crash)
- [ ] Phase 6: State management & hooks (blocked by crash)
- [ ] Phase 7: Input & keyboard handling (blocked by crash)
- [ ] Phase 8: Integration & testing (blocked by crash)
- [ ] Phase 9: Migration & deployment (blocked by crash)

**Estimated Progress**: 50% (architecture complete, runtime blocked)

## Recommendation

Given the Bun FFI blocker, recommend:
1. **Investigate Ink** as alternative TUI framework (no FFI, pure Node.js)
2. **Test Deno** as Bun alternative (better ESM support)
3. **Continue with Go TUI** until TypeScript runtime stabilizes

The TypeScript architecture (services, types, state machines) can be preserved regardless of TUI framework choice.
