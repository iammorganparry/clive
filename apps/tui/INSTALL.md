# Clive TUI Installation Guide

## Setup

The `clive` command is a launcher script that runs the TUI from your workspace.

### 1. Ensure the launcher script exists

The launcher should be at: `/Users/morganparry/bin/clive`

Make sure it's executable:
```bash
chmod +x ~/bin/clive
```

Make sure `~/bin` is in your PATH (add to `~/.bashrc` or `~/.zshrc`):
```bash
export PATH="$HOME/bin:$PATH"
```

### 2. Install workspace dependencies

```bash
cd ~/repos/clive
yarn install
```

### 3. Test the installation

```bash
clive --help
```

You should see the help message.

## Workspace Detection

The launcher automatically detects your workspace by checking these locations in order:

1. `$CLIVE_WORKSPACE` environment variable (if set)
2. `~/repos/clive` (default)
3. `~/clive`
4. `~/projects/clive`
5. `~/src/clive`

### Custom Workspace Location

If your workspace is in a different location, set the environment variable:

```bash
# Temporary (current shell only)
export CLIVE_WORKSPACE=/path/to/your/clive

# Permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export CLIVE_WORKSPACE=/path/to/your/clive' >> ~/.zshrc
```

## Usage

```bash
# Normal mode
clive

# Debug mode (recommended for troubleshooting)
clive --debug

# View help
clive --help
```

## Troubleshooting

### "Could not locate Clive workspace"

The launcher couldn't find your workspace. Either:
1. Move your workspace to `~/repos/clive`, or
2. Set `CLIVE_WORKSPACE` environment variable to your workspace path

### "Workspace dependencies not installed"

Run `yarn install` in your workspace:
```bash
cd ~/repos/clive  # or your workspace location
yarn install
```

### "bun not found"

Install Bun from https://bun.sh:
```bash
curl -fsSL https://bun.sh/install | bash
```

### Verify workspace detection

Run with debug flag to see which workspace was detected:
```bash
clive --debug
```

You should see:
```
Workspace: /Users/morganparry/repos/clive

Debug logging enabled. Log file: /Users/morganparry/.clive/tui-debug.log
...
```

## Development

For development with auto-reload:

```bash
cd ~/repos/clive
yarn workspace @clive/tui dev
```

This automatically enables debug logging.
