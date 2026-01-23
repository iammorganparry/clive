# Linear Integration Setup

This guide explains how to configure Clive TUI to work with Linear.

## Quick Setup

When you first run Clive TUI, it will prompt you to configure Linear:

1. Select "Linear" from the setup menu
2. Enter your Linear API key (get it from https://linear.app/settings/api)
3. Select your team

**Your API key will be automatically saved to `~/.clive/.env` and is NOT stored in config files.**

## Manual Setup

### 1. Get Your Linear API Key

1. Go to https://linear.app/settings/api
2. Create a new Personal API Key
3. Copy the key (starts with `lin_api_`)

### 2. Configure the API Key

The API key can be configured in two ways:

#### Option A: Use the Interactive Setup (Recommended)

Run Clive TUI and follow the setup wizard. The key will be automatically saved to `~/.clive/.env`.

#### Option B: Set Environment Variable Manually

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export LINEAR_API_KEY="lin_api_your_key_here"
```

Or add to `~/.clive/.env`:

```bash
LINEAR_API_KEY=lin_api_your_key_here
```

### 3. Configure Your Team

Edit `~/.clive/config.json`:

```json
{
  "issueTracker": "linear",
  "linear": {
    "teamID": "your-team-id-here"
  }
}
```

**Note:** You can find your team ID by running the interactive setup, or by querying the Linear API.

## Security

- **API keys are stored in `~/.clive/.env` with restricted permissions (600)**
- **API keys are NOT stored in config.json files**
- **Never commit `.env` files to git**
- The TUI checks for `LINEAR_API_KEY` in this priority order:
  1. `LINEAR_API_KEY` environment variable (your shell)
  2. `~/.clive/.env` file
  3. Config file (legacy, not recommended)

## Per-Project Configuration

To use different Linear teams for different projects:

1. Create a `.clive/config.json` in your project directory:

```json
{
  "issueTracker": "linear",
  "linear": {
    "teamID": "project-specific-team-id"
  }
}
```

2. The API key will still be read from `LINEAR_API_KEY` env var or `~/.clive/.env`

This allows you to:
- **Share the same API key across all projects**
- **Use different teams per project**
- **Keep credentials secure and separate from project configs**

## Troubleshooting

### "Linear API key is missing in workspace config"

This means either:
1. You haven't set `LINEAR_API_KEY` environment variable
2. The `~/.clive/.env` file is missing or doesn't contain the key

**Solution:** Run the interactive setup again, or manually set `LINEAR_API_KEY`.

### "401 Unauthorized" Errors

Your API key is invalid or expired.

**Solution:**
1. Generate a new API key at https://linear.app/settings/api
2. Update `~/.clive/.env` or your shell's `LINEAR_API_KEY` env var

### "Linear team ID is missing"

The config file doesn't specify which team to use.

**Solution:** Run the interactive setup or manually add `teamID` to your config file.

## Migration from Old Config Format

If you have an old config with embedded API keys:

### Old format (insecure):
```json
{
  "issue_tracker": "linear",
  "linear": {
    "api_key": "lin_api_...",
    "team_id": "..."
  }
}
```

### New format (secure):
**`~/.clive/.env`:**
```bash
LINEAR_API_KEY=lin_api_...
```

**`~/.clive/config.json`:**
```json
{
  "issueTracker": "linear",
  "linear": {
    "teamID": "..."
  }
}
```

The TUI will automatically migrate your config when you run the setup flow again.
