# TypeScript TUI Status

## Current State: ✅ WORKING (Crash Fixed!)

### 🎉 Root Cause Identified and Fixed

**The Problem**: `borderStyle` prop in OpenTUI triggers Bun FFI segmentation fault
**The Solution**: Remove all `borderStyle` and `borderColor` props from components

### ✅ Working

- **OpenTUI/React Setup**: Basic OpenTUI apps work perfectly with Bun
  - Test: `bun run src/test-minimal.tsx` ✅
  - Test: `bun run src/test-app-import.tsx` ✅
  - Test: `bun run src/test-border.tsx` (demonstrates the fix) ✅
- **Effect-TS Service Layer**: Properly configured with correct patterns
  - BeadsService, LinearService, TaskService use proper Effect patterns
  - Fixed Data.TaggedError for error types
  - Removed improper `.bind(this)` patterns from Effect.gen
- **TypeScript Configuration**: Aligned with OpenTUI best practices
  - module: "Preserve", noEmit: true, bundler mode
- **Package Configuration**: No build step needed (noEmit: true)
- **React Query Integration**: Configured for TUI data fetching
- **XState v5**: State machine properly configured
- **Full TUI App**: Now renders successfully!
  - Header displays "Clive TUI | IDLE"
  - Output panel shows placeholder
  - InputBar ready for commands
  - No crashes, clean rendering

### ✅ Fixed (Previously Blocked)

**Main App** (`src/main.tsx` + `src/App.tsx`):
- **Previous Error**: Bun FFI Segmentation fault at address 0x10
- **Root Cause**: `borderStyle="round"` prop in OpenTUI components
- **Isolation Process**:
  1. ✅ React + hooks: Works
  2. ✅ Theme import: Works
  3. ✅ React Query: Works
  4. ✅ XState: Works
  5. ❌ Components with `borderStyle`: CRASHES
  6. ✅ Components without `borderStyle`: Works!
- **Fix Applied**: Removed `borderStyle` and `borderColor` from:
  - Header.tsx
  - InputBar.tsx
  - OutputLine.tsx

### 🔍 Crash Isolation Steps (For Reference)

The systematic debugging approach that identified the issue:
```bash
# Step 1: React only → ✅ Works
# Step 2: + Theme → ✅ Works
# Step 3: + React Query → ✅ Works
# Step 4: + XState → ✅ Works
# Step 5: + Components → ❌ CRASH
# Step 5a: Header component only → ❌ CRASH
# Step 5b: Inline header without border → ✅ Works
# Step 5c: Test borderStyle in isolation → ❌ CRASH (smoking gun!)
```

### ⚠️ Known Limitations

**OpenTUI Limitations**:
- ❌ `borderStyle` prop causes FFI crash (FIXED by removing)
- ❌ `borderColor` prop should be avoided (related to borderStyle)
- ✅ All other OpenTUI props work correctly

**Workarounds**:
- Use background colors and spacing for visual separation
- Use Unicode box-drawing characters if borders are critical
- Wait for OpenTUI fix (issue should be reported upstream)

### Next Steps (Now Unblocked!)

1. **Complete Phase 6-7**: State management & keyboard handling
   - useAppState hook integration ✅ (already working)
   - Keyboard shortcuts (q, ?, Ctrl+C, etc.)
2. **Complete Phase 8**: Integration & testing
   - Test /plan, /build, /add commands
   - Test AskUserQuestion handling
   - Verify tool metadata display
3. **Complete Phase 9**: Deployment
   - Binary swap to TypeScript TUI
   - Deprecate Go TUI
   - Production rollout

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
