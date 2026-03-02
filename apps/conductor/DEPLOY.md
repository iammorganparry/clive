# Conductor — Mac Mini Deployment Guide

Quick setup guide for deploying the OpenClaw Conductor on Mac Mini.

## Prerequisites

```bash
# Node.js 22+
node --version  # should be ^22.21.0

# Yarn 1.x
yarn --version

# gh CLI (authenticated)
gh auth status

# pm2 (process manager)
npm install -g pm2

# tsx (TypeScript executor)
npm install -g tsx
```

## 1. Install OpenClaw Gateway

```bash
# Install OpenClaw CLI
npm install -g openclaw@latest

# Onboard and start the daemon (runs on port 18789)
openclaw onboard --install-daemon

# Install the ACP agent plugin
openclaw plugins install @openclaw/acpx
openclaw config set plugins.entries.acpx.enabled true
openclaw config set plugins.entries.acpx.config.permissionMode approve-all
openclaw config set plugins.entries.acpx.config.nonInteractivePermissions deny

# Verify gateway is running
openclaw gateway status
openclaw acp doctor
```

## 2. Install Dependencies

```bash
cd /Users/morganparry/repos/clive
yarn install
```

## 3. Configure Environment

Create `apps/conductor/.env`:

```bash
# Required
CONDUCTOR_WORKSPACE=/Users/morganparry/repos/clive
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token

# Optional (defaults shown)
CONDUCTOR_PORT=3847
CONDUCTOR_MAX_AGENTS=3
CONDUCTOR_MONITOR_INTERVAL=30000
CONDUCTOR_WORKTREE_DIR=~/.clive/worktrees
CONDUCTOR_REGISTRY_PATH=.conductor/active-tasks.json
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
CONDUCTOR_MAX_RETRIES=3
CONDUCTOR_STUCK_THRESHOLD=10
```

## 4. Create Required Directories

```bash
mkdir -p ~/.clive/worktrees
mkdir -p /Users/morganparry/repos/clive/.conductor
```

## 5. Quick Test (Manual Start)

```bash
cd /Users/morganparry/repos/clive/apps/conductor
yarn start

# In another terminal — verify it's running
curl http://localhost:3847/health

# Submit a test request
curl -X POST http://localhost:3847/request \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "test ping"}'

# Check tasks
curl http://localhost:3847/tasks
```

## 6. Deploy with pm2 (Production)

```bash
cd /Users/morganparry/repos/clive/apps/conductor

# Start the conductor
pm2 start ecosystem.config.cjs

# Verify it's running
pm2 status
pm2 logs conductor --lines 20

# Save the process list (persists across reboots)
pm2 save

# Setup auto-start on Mac Mini boot
pm2 startup
# Follow the printed command (sudo env PATH=... pm2 startup ...)
```

### pm2 Management Commands

```bash
pm2 status              # Check if conductor is running
pm2 logs conductor      # Tail logs
pm2 restart conductor   # Restart
pm2 stop conductor      # Stop
pm2 delete conductor    # Remove from pm2
pm2 monit               # Interactive monitoring dashboard
```

## 7. Verify End-to-End

```bash
# 1. Check health
curl http://localhost:3847/health
# Should return: {"status":"ok","activeTasks":0,"governor":{"active":0,"queued":0,"max":3,...}}

# 2. Check OpenClaw gateway
openclaw gateway status
# Should show gateway running on port 18789

# 3. Test from Slack (if Slack bot is configured)
# In any Slack channel where Clive is present:
#   @clive conduct "add a hello world endpoint"
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `CONDUCTOR_PORT` | `3847` | HTTP server port |
| `CONDUCTOR_MAX_AGENTS` | `3` | Max concurrent OpenClaw agents |
| `CONDUCTOR_MONITOR_INTERVAL` | `30000` | Health check interval (ms) |
| `CONDUCTOR_WORKSPACE` | `cwd()` | Path to the clive repo |
| `CONDUCTOR_WORKTREE_DIR` | `~/.clive/worktrees` | Where git worktrees are created |
| `CONDUCTOR_REGISTRY_PATH` | `.conductor/active-tasks.json` | Task state persistence file |
| `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw gateway address |
| `SLACK_BOT_TOKEN` | — | Slack bot token for status reporting |
| `CONDUCTOR_MAX_RETRIES` | `3` | Max retries before failing a task |
| `CONDUCTOR_STUCK_THRESHOLD` | `10` | Minutes before agent considered stuck |

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + governor stats |
| `/request` | POST | Submit orchestration request |
| `/status/:id` | GET | Get task status by ID |
| `/tasks` | GET | List all tasks |
| `/cancel/:id` | POST | Cancel a running task |

### POST /request Body

```json
{
  "prompt": "Build a user dashboard with charts",
  "slackThread": {
    "channel": "C12345",
    "threadTs": "1234567890.123456",
    "initiatorId": "U12345"
  }
}
```

Fast path (skip planning, use existing Linear issues):

```json
{
  "linearIssueUrls": [
    "https://linear.app/team/issue/PROJ-123",
    "https://linear.app/team/issue/PROJ-124"
  ]
}
```

## Troubleshooting

### Conductor won't start
```bash
# Check if port is in use
lsof -i :3847

# Check logs
pm2 logs conductor --lines 50

# Try manual start for better error output
cd apps/conductor && yarn start
```

### Agents not spawning
```bash
# Verify OpenClaw gateway
openclaw gateway status
openclaw acp doctor

# Test acpx directly
acpx claude --help

# Check worktree directory permissions
ls -la ~/.clive/worktrees/
```

### Stuck tasks
```bash
# Check active tasks
curl http://localhost:3847/tasks | jq '.[] | select(.state != "complete" and .state != "failed")'

# Cancel a stuck task
curl -X POST http://localhost:3847/cancel/TASK_ID

# Nuclear option: reset registry
rm .conductor/active-tasks.json
pm2 restart conductor
```

### Worktree cleanup
```bash
# Prune stale worktrees
cd /Users/morganparry/repos/clive
git worktree prune

# Remove all clive worktrees
rm -rf ~/.clive/worktrees/*
git worktree prune
```
