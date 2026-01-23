# Clive TUI (TypeScript/React)

TypeScript/React-based TUI for Clive, migrating from Go/Bubble Tea.

## Status: In Development (Phase 5/9 Complete)

**Completed:**
- ✅ Phase 0: Shared package refactoring (`@clive/claude-services`)
- ✅ Phase 1: Environment setup & hello world
- ✅ Phase 2-3: Backend services & React components
- ✅ Phase 4-5: State management (XState) & UI components
- ✅ Effect services for Beads/Linear abstraction
- ✅ React Query integration for data fetching

**Remaining:**
- ⏳ Phase 6: Integration & Testing
- ⏳ Phase 7: Input & Keyboard Handling
- ⏳ Phase 8: Performance Testing
- ⏳ Phase 9: Migration & Deployment

## Architecture

### Stack
- **Runtime**: Bun (required for OpenTUI compatibility)
- **UI Framework**: OpenTUI/React (React reconciler + Zig native layer)
- **State Management**: XState v5
- **Data Fetching**: @tanstack/react-query v5
- **Service Layer**: Effect-TS
- **Styling**: One Dark Pro theme

### Services
- **BeadsService**: Effect wrapper for beads CLI operations
- **LinearService**: Effect wrapper for Linear GraphQL API
- **TaskService**: Unified task management (Beads/Linear abstraction)
- **CliManager**: CLI execution with event enrichment pipeline

## Linear Integration Setup

Clive TUI integrates with Linear for task and issue management. See [LINEAR_SETUP.md](./LINEAR_SETUP.md) for detailed instructions.

### Quick Setup

1. Get your Linear API key from https://linear.app/settings/api
2. Run Clive TUI - it will guide you through the setup
3. Your API key will be saved securely to `~/.clive/.env`

### Configuration Files

- **`~/.clive/.env`** - Stores your Linear API key (secure, not committed to git)
- **`~/.clive/config.json`** - Stores your team ID and preferences
- **`<project>/.clive/config.json`** - Project-specific team configuration (optional)

### Security Features

✅ API keys are stored in `~/.clive/.env` with restricted permissions (600)
✅ API keys are NOT stored in config.json files
✅ `.env` files are gitignored to prevent accidental commits
✅ Environment variables take priority over config files

### Configuration Priority

Configuration is loaded in this order (highest to lowest priority):

1. `LINEAR_API_KEY` environment variable
2. `~/.clive/.env` file
3. `<workspace>/.clive/config.json` (project-specific)
4. `~/.clive/config.json` (global)

This allows you to:
- Use one API key across all projects
- Override team settings per project
- Keep credentials secure and separate from project files

## Known Issues

### Runtime Errors

#### 1. OpenTUI `renderer.once` undefined
**Error:** `'renderer.once' is undefined`
**Location:** `@opentui/react/index.js:644:16` in `createRoot()`
**Status:** Blocking execution
**Details:** The OpenTUI renderer instance doesn't have the expected `once` method. This may be:
- An OpenTUI version incompatibility
- Missing initialization step
- Breaking change in OpenTUI API

**Workaround:** Using Go TUI binary until resolved

#### 2. tsx + .scm files
**Error:** `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".scm"`
**Location:** OpenTUI tree-sitter grammar files
**Status:** Resolved by switching to bun
**Details:** tsx (TypeScript executor) cannot handle .scm files (Scheme/tree-sitter grammars)

## Project Structure

```
apps/tui/
├── bin/
│   └── clive              # Wrapper script (ready for future use)
├── src/
│   ├── main.tsx           # Entry point
│   ├── App.tsx            # Root component with QueryClient
│   ├── components/
│   │   ├── Header.tsx     # Status bar
│   │   ├── InputBar.tsx   # Command input
│   │   ├── OutputLine.tsx # Type-specific line rendering
│   │   └── OutputPanel.tsx # Scrollable output
│   ├── hooks/
│   │   ├── useAppState.ts     # XState state machine
│   │   └── useTaskQueries.ts  # React Query hooks
│   ├── services/
│   │   ├── CliManager.ts      # CLI execution orchestrator
│   │   ├── DiffDetector.ts    # File diff generation
│   │   ├── SubagentTracker.ts # Task tool lifecycle
│   │   ├── MetadataCalculator.ts # Cost/token tracking
│   │   └── TaskService.ts     # Beads/Linear abstraction
│   ├── types/
│   │   └── index.ts       # Type definitions
│   └── styles/
│       └── theme.ts       # One Dark Pro colors
└── package.json
```

## Usage (When Fixed)

### Development
```bash
cd apps/tui
yarn dev        # Watch mode with tsx
```

### Production
```bash
# Via wrapper script (when ready)
./apps/tui/bin/clive

# Or with bun directly
cd /path/to/clive
bun run apps/tui/src/main.tsx
```

### Binary Installation
```bash
# Symlink to ~/bin (when TUI is working)
ln -sf /path/to/clive/apps/tui/bin/clive ~/bin/clive-tui
ln -sf ~/bin/clive-tui ~/bin/clive
```

## Testing Checklist (Phase 6)

- [ ] Fix OpenTUI renderer initialization
- [ ] Spawn Claude process and see streaming output
- [ ] Execute /plan command
- [ ] Execute /build command with iteration loop
- [ ] Handle AskUserQuestion tool
- [ ] Display tool metadata (duration, tokens, cost)
- [ ] Show file diffs for Edit/Write tools
- [ ] Navigate between views
- [ ] Load sessions and tasks from Beads/Linear
- [ ] Handle process crashes gracefully

## Dependencies

### Required
- **bun**: Runtime with better file type support than Node.js
- **@opentui/core**: Terminal rendering engine
- **@opentui/react**: React reconciler for OpenTUI
- **@clive/claude-services**: Shared Effect services

### Key Libraries
- **xstate**: State machine library
- **@tanstack/react-query**: Data fetching/caching
- **effect**: Functional effect system

## Migration Notes

This TUI is part of a comprehensive migration from Go (2,900 lines) to TypeScript.

**Benefits:**
- React expertise → faster development
- Component composition → better code organization
- TypeScript → type safety throughout
- Sub-millisecond rendering via Zig
- Shared services with VSCode extension

**Trade-offs:**
- Runtime complexity (need bun, not just node)
- OpenTUI ecosystem maturity
- Additional dependencies

## Current Binary

The `clive` command currently points to the **Go TUI** (`clive-tui-go`) until the TypeScript version is fully functional.

To test TypeScript TUI manually:
```bash
cd /path/to/clive
bun run apps/tui/src/main.tsx
```

## Contributing

When the TypeScript TUI is ready for production, update the binary symlink:
```bash
cd ~/bin
rm clive-tui
ln -sf /path/to/clive/apps/tui/bin/clive clive-tui
```

## References

- [Migration Plan](/.claude/plans/woolly-sauteeing-naur.md)
- [OpenTUI Docs](https://opentui.dev)
- [XState v5 Docs](https://stately.ai/docs/xstate)
- [React Query Docs](https://tanstack.com/query/latest)
- [Effect-TS Docs](https://effect.website)
