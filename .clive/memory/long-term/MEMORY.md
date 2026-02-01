# Clive Long-Term Memory

This file contains curated persistent knowledge about the Clive codebase.
Important discoveries, patterns, and decisions should be promoted here from daily logs.

---

## Architecture Decisions

### Effect-TS Service Pattern
All services in the codebase use Effect-TS for functional side effect management.
Services are organized in tiers (Tier 0-3) with clear dependency injection via layers.
See `apps/extension/src/services/layer-factory.ts` for the canonical pattern.

### Monorepo Structure
- Apps go in `apps/`
- Shared packages go in `packages/`
- Build tooling goes in `tooling/`
- Configuration lives in `.clive/`

---

## Code Patterns

### Creating New Services
1. Create class extending `Effect.Service`
2. Export `*ServiceLive` as the default layer
3. Add to appropriate tier in layer-factory
4. Use `Effect.gen` for generator-based composition

### MCP Tool Implementation
1. Define tool schema in `*ToolDefinition`
2. Implement `execute*` function using Effect
3. Create `handle*` wrapper for MCP protocol
4. Export from package index

---

## Known Gotchas

### Claude CLI stdin/stdout
- Must use `--input-format stream-json` for bidirectional communication
- Tool results sent via stdin wrapped in `user` message
- Watch for duplicate tool_result bugs (track via Set)

### Better-SQLite3
- Uses native bindings - needs rebuild on Node version change
- WAL mode required for concurrent access
- FTS5 virtual tables need explicit triggers for sync

---

## Session Notes

*Promote important entries from daily logs here*
