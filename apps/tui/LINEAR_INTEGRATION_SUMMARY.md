# Linear Integration Fix - Implementation Summary

## Overview

Fixed the Linear integration to use environment variables for API keys instead of storing them in config files. This improves security and prevents accidental credential leaks.

## Changes Made

### 1. Environment Variable Support

**File**: `apps/tui/src/hooks/useTaskQueries.ts`

- Added `normalizeLinearConfig()` function that prioritizes `LINEAR_API_KEY` env var over config file
- Priority: `process.env.LINEAR_API_KEY` > config `apiKey` > config `api_key`
- Maintains backwards compatibility with old config formats

### 2. Secure Credential Storage

**File**: `apps/tui/src/hooks/useViewMode.ts`

Added new functions:
- `loadEnvFile()` - Loads environment variables from `~/.clive/.env` on startup
- `saveApiKey()` - Saves API key to `~/.clive/.env` with 600 permissions
- Modified `saveConfig()` - Extracts and saves API key separately, removes from config.json

**Security Features**:
- API keys saved to `~/.clive/.env` with restricted permissions (600)
- API keys NOT stored in config.json files
- .env file automatically loaded on TUI startup
- Environment variables set in current process

### 3. Updated Configuration Files

**`~/.clive/config.json`**:
```json
{
  "issueTracker": "linear",
  "linear": {
    "teamID": "820895fa-6dca-4faa-85be-81106080397a"
  }
}
```
❌ No `apiKey` field

**`~/.clive/.env`** (new):
```bash
LINEAR_API_KEY=lin_api_...
```
✅ API key stored securely with 600 permissions

### 4. Updated Tests

**File**: `apps/tui/src/hooks/__tests__/useTaskQueries.test.ts`

Added test coverage for:
- Environment variable priority over config file
- Fallback to config file when env var not set
- Using env var even when config has no apiKey field
- All existing tests updated to clear `LINEAR_API_KEY` env var in setup

### 5. Documentation

**Created**:
- `apps/tui/LINEAR_SETUP.md` - Comprehensive setup guide with troubleshooting
- `apps/tui/README.md` - Added Linear Integration section

**Content**:
- Quick setup instructions
- Manual setup options
- Security features explanation
- Configuration priority order
- Troubleshooting guide
- Migration guide from old format

### 6. Git Security

**File**: `.gitignore`

Added:
```
.clive/.env
```

Ensures environment files are never committed to git.

## Configuration Priority

API keys are loaded in this order (highest to lowest priority):

1. **`LINEAR_API_KEY` environment variable** (set in shell)
2. **`~/.clive/.env` file** (loaded automatically by TUI)
3. **Config file `apiKey`** (legacy, still supported)

Team IDs are loaded from:
1. **`<workspace>/.clive/config.json`** (project-specific)
2. **`~/.clive/config.json`** (global)

## Benefits

### Security
- ✅ API keys no longer stored in config.json
- ✅ .env file has restrictive permissions (600)
- ✅ .env files are gitignored
- ✅ Reduces risk of credential leaks

### Flexibility
- ✅ One API key works across all projects
- ✅ Different teams per project
- ✅ Easy to rotate credentials (just update .env file)
- ✅ Can override via shell environment variable

### Backwards Compatibility
- ✅ Old config files still work (with deprecation path)
- ✅ Automatic migration on next setup
- ✅ Field name normalization (snake_case → camelCase)

## User Experience

### First-Time Setup
1. User runs TUI for the first time
2. Interactive setup prompts for API key
3. API key saved to `~/.clive/.env` (secure)
4. Team ID saved to `~/.clive/config.json`
5. User can start using Linear integration

### Existing Users
1. User has old config with embedded API key
2. API key still works (backwards compatible)
3. Next time they run setup, key is migrated to .env
4. Old config key is removed

### Per-Project Setup
1. User can create `.clive/config.json` in project
2. Project config specifies team ID
3. API key still read from global `~/.clive/.env`
4. No need to duplicate credentials

## Testing

### Unit Tests
```bash
cd apps/tui
yarn test:unit
```

Tests cover:
- Environment variable priority
- Config field normalization
- Validation errors
- Backwards compatibility

### Manual Testing
```bash
# Test with env var
export LINEAR_API_KEY="lin_api_..."
cd apps/tui
yarn dev

# Test with .env file
unset LINEAR_API_KEY
cat > ~/.clive/.env << EOF
LINEAR_API_KEY=lin_api_...
EOF
chmod 600 ~/.clive/.env
yarn dev
```

## Migration Guide for Users

### From Old Format

**Old** `~/.clive/config.json`:
```json
{
  "issue_tracker": "linear",
  "linear": {
    "api_key": "lin_api_...",
    "team_id": "..."
  }
}
```

**New** `~/.clive/.env`:
```bash
LINEAR_API_KEY=lin_api_...
```

**New** `~/.clive/config.json`:
```json
{
  "issueTracker": "linear",
  "linear": {
    "teamID": "..."
  }
}
```

### Migration Steps

**Option 1**: Run setup again (automatic migration)
```bash
clive
# Select "Linear" from setup menu
# Enter your API key
# Select your team
```

**Option 2**: Manual migration
```bash
# 1. Extract API key from config
cat ~/.clive/config.json | jq -r '.linear.api_key'

# 2. Save to .env
echo "LINEAR_API_KEY=lin_api_..." > ~/.clive/.env
chmod 600 ~/.clive/.env

# 3. Remove from config
cat ~/.clive/config.json | jq 'del(.linear.api_key) | del(.linear.apiKey)' > /tmp/config.json
mv /tmp/config.json ~/.clive/config.json
```

## Files Modified

```
Modified:
✏️  apps/tui/src/hooks/useTaskQueries.ts
✏️  apps/tui/src/hooks/useViewMode.ts
✏️  apps/tui/src/hooks/__tests__/useTaskQueries.test.ts
✏️  apps/tui/src/components/SelectionView.tsx
✏️  apps/tui/src/hooks/useAppState.ts
✏️  apps/tui/src/App.tsx
✏️  apps/tui/package.json
✏️  apps/tui/README.md
✏️  .gitignore
✏️  ~/.clive/config.json
✏️  .clive/config.json

Created:
✨  apps/tui/LINEAR_SETUP.md
✨  apps/tui/vitest.config.ts
✨  apps/tui/src/hooks/__tests__/useTaskQueries.test.ts
✨  ~/.clive/.env
```

## Next Steps

1. **Install dependencies**: `cd apps/tui && yarn install`
2. **Run tests**: `yarn test:unit`
3. **Test TUI**: `yarn dev`
4. **Verify Linear integration**: Issues should load successfully
5. **Commit changes**: All credential files are gitignored

## Troubleshooting

### "Linear API key is missing"

Check that `~/.clive/.env` exists and contains:
```bash
LINEAR_API_KEY=lin_api_...
```

Or set environment variable:
```bash
export LINEAR_API_KEY="lin_api_..."
```

### "401 Unauthorized"

API key is invalid. Generate a new one at https://linear.app/settings/api

### Tests failing

Install dependencies:
```bash
cd apps/tui
yarn install
```

### .env not loading

The TUI automatically loads `~/.clive/.env` on startup via `loadEnvFile()` in `useViewMode.ts`.

If using outside TUI, you can manually load:
```bash
export $(cat ~/.clive/.env | xargs)
```
