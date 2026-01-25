# Clive Slack Integration Setup Guide

This guide walks you through setting up the Clive Slack integration from scratch.

**Distributed Mode** (default) is recommended - it runs a central service that routes to worker processes running Claude CLI locally. No ngrok required for workers.

**Local Mode** (legacy) is available for single-user setups but requires ngrok.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Create Slack App](#create-slack-app)
3. [Local Mode Setup](#local-mode-setup)
4. [Distributed Mode Setup](#distributed-mode-setup)
5. [Testing Your Setup](#testing-your-setup)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### All Modes

- [ ] Node.js 18+ installed
- [ ] Yarn package manager
- [ ] Claude CLI installed and authenticated
- [ ] A Slack workspace where you can create apps

### Verify Claude CLI

```bash
# Check Claude CLI is installed
which claude

# Check authentication
claude whoami
```

If not installed:
```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-code

# Authenticate
claude login
```

### Install Dependencies

```bash
cd /Users/morganparry/repos/clive

# Install all dependencies
yarn install

# Build the worker-protocol package
yarn workspace @clive/worker-protocol build
```

---

## Create Slack App

This step is the same for both Local and Distributed modes.

### Step 1: Create the App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Choose **From scratch**
4. Enter:
   - **App Name**: `Clive`
   - **Workspace**: Select your workspace
5. Click **Create App**

### Step 2: Configure Bot Token Scopes

1. In the sidebar, click **OAuth & Permissions**
2. Scroll to **Scopes** → **Bot Token Scopes**
3. Click **Add an OAuth Scope** and add these scopes:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Read @mentions |
| `chat:write` | Post messages |
| `channels:history` | Read public channel messages |
| `groups:history` | Read private channel messages |
| `reactions:write` | Add emoji reactions |

### Step 3: Install to Workspace

1. Scroll up to **OAuth Tokens for Your Workspace**
2. Click **Install to Workspace**
3. Review permissions and click **Allow**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

> 📝 Save this token - you'll need it for configuration.

### Step 4: Get Signing Secret

1. In the sidebar, click **Basic Information**
2. Scroll to **App Credentials**
3. Copy the **Signing Secret**

> 📝 Save this secret - you'll need it for configuration.

### Step 5: Enable Event Subscriptions

1. In the sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** to **On**
3. Leave the Request URL blank for now (we'll add it after starting the app)
4. Scroll to **Subscribe to bot events**
5. Click **Add Bot User Event** and add:

| Event | Purpose |
|-------|---------|
| `app_mention` | When @clive is mentioned |
| `message.channels` | Messages in public channels |
| `message.groups` | Messages in private channels |

6. Click **Save Changes**

### Step 6: Enable Interactivity

1. In the sidebar, click **Interactivity & Shortcuts**
2. Toggle **Interactivity** to **On**
3. Leave Request URL blank for now
4. Click **Save Changes**

---

## Local Mode Setup

Best for: Personal use, quick testing, single user.

### Step 1: Get ngrok Auth Token

1. Sign up at [ngrok.com](https://ngrok.com) (free tier works)
2. Go to [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copy your auth token

### Step 2: Configure Environment

All environment variables are configured in the **monorepo root** `.env` file.

```bash
cd /Users/morganparry/repos/clive

# Add to root .env file
cat >> .env << 'EOF'

# Slack Integration - Local Mode
CLIVE_MODE=local
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
NGROK_AUTH_TOKEN=your-ngrok-token-here
SLACK_PORT=3000
EOF
```

Edit the file with your actual values:
```bash
nano .env
# or
code .env
```

### Step 3: Start the App

```bash
# From monorepo root
yarn workspace @clive/slack dev
```

You should see:
```
Clive Slack app starting...

Configuration loaded successfully
Mode: LOCAL
Port: 3000

Starting in LOCAL mode...

ngrok tunnel established: https://xxxx-xx-xx-xxx-xxx.ngrok-free.app

Slack webhook URL: https://xxxx-xx-xx-xxx-xxx.ngrok-free.app/slack/events

Configure this URL in your Slack app's Event Subscriptions.

Clive Slack app is running on port 3000
Ready to receive @clive mentions!
```

### Step 4: Configure Slack Request URLs

1. Copy the ngrok URL from the output (e.g., `https://xxxx.ngrok-free.app/slack/events`)

2. Go back to your Slack app settings

3. **Event Subscriptions**:
   - Paste the URL in **Request URL**
   - Wait for "Verified" ✓
   - Click **Save Changes**

4. **Interactivity & Shortcuts**:
   - Paste the same URL in **Request URL**
   - Click **Save Changes**

### Step 5: Invite Bot to Channel

In Slack:
```
/invite @Clive
```

### Step 6: Test It

In the channel, type:
```
@Clive help me plan a new feature
```

**You're done with Local Mode!** 🎉

---

## Distributed Mode Setup

Best for: Teams, multiple users, production deployment.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    DEPLOYED SERVER                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Central Slack Service                 │   │
│  │  • Receives @mentions from Slack                 │   │
│  │  • Routes work to available workers              │   │
│  │  • WebSocket server for worker connections       │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
    │ Worker  │    │ Worker  │    │ Worker  │
    │ (You)   │    │ (Alice) │    │ (Bob)   │
    │ Claude  │    │ Claude  │    │ Claude  │
    │ CLI     │    │ CLI     │    │ CLI     │
    └─────────┘    └─────────┘    └─────────┘
```

### Part A: Central Service Setup

#### A1. Generate API Token

Generate a secure shared secret:
```bash
# Generate a 32-byte hex token
openssl rand -hex 32
```

> 📝 Save this token - all workers will need it.

#### A2. Configure Central Service

All environment variables are configured in the **monorepo root** `.env` file.

```bash
cd /Users/morganparry/repos/clive

# Add to root .env file
cat >> .env << 'EOF'

# Slack Integration - Distributed Mode
CLIVE_MODE=distributed
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
CLIVE_WORKER_API_TOKEN=your-generated-token-here
SLACK_PORT=3000
CLIVE_WS_PATH=/ws
EOF
```

Edit with your actual values:
```bash
nano .env
```

#### A3. Start Central Service (Local Testing)

For local testing before deployment:
```bash
yarn workspace @clive/slack dev
```

You should see:
```
Clive Slack app starting...

Configuration loaded successfully
Mode: DISTRIBUTED
Port: 3000

Starting in DISTRIBUTED mode...

HTTP server listening on port 3000
WebSocket endpoint: ws://localhost:3000/ws

Waiting for workers to connect...
```

#### A4: Deploy Central Service (Production)

For production, deploy to a server with a stable URL. Options:

**Option 1: Railway**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

**Option 2: Render**
1. Connect your repo to [render.com](https://render.com)
2. Create a new Web Service
3. Set build command: `yarn install && yarn workspace @clive/worker-protocol build`
4. Set start command: `yarn workspace @clive/slack start`
5. Add environment variables

**Option 3: Docker**
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN yarn install
RUN yarn workspace @clive/worker-protocol build
EXPOSE 3000
CMD ["yarn", "workspace", "@clive/slack", "start"]
```

#### A5: Configure Slack Request URLs

Once deployed, update your Slack app:

1. **Event Subscriptions**:
   - Set Request URL to: `https://your-deployed-url.com/slack/events`
   - Wait for "Verified" ✓
   - Click **Save Changes**

2. **Interactivity & Shortcuts**:
   - Set Request URL to: `https://your-deployed-url.com/slack/events`
   - Click **Save Changes**

### Part B: Worker Setup

Each team member runs this on their machine.

#### B1. Configure Worker

All environment variables are configured in the **monorepo root** `.env` file.

```bash
cd /Users/morganparry/repos/clive

# Add to root .env file
cat >> .env << 'EOF'

# Worker Configuration
CLIVE_WORKER_TOKEN=your-shared-token-here
CLIVE_CENTRAL_URL=ws://localhost:3000/ws

# Projects (choose one method)
CLIVE_WORKSPACE_ROOT=/Users/me/projects/my-app
# CLIVE_WORKSPACE_ROOTS=/Users/me/projects/frontend,/Users/me/projects/backend
# CLIVE_PROJECTS='[{"id":"frontend","name":"Frontend App","path":"/path","aliases":["fe"]}]'
EOF
```

Edit with your actual values:
```bash
nano .env
```

**Project Routing**: When users mention a project in their request (e.g., "@clive fix the bug in our frontend app"), the central service automatically routes to a worker that has access to that project.

#### B2. Start Worker

```bash
# From monorepo root
yarn workspace @clive/worker dev
```

You should see:
```
Clive Worker starting...

Configuration:
  Central URL: ws://localhost:3000/ws
  Workspace:   /Users/morganparry/repos/clive
  Hostname:    your-machine.local

Connected to central service
Worker worker-abc12345 is ready
Waiting for interview requests...
```

The central service will log:
```
[WorkerRegistry] Worker registered: worker-abc12345 (your-machine.local)
```

#### B3: Invite Bot and Test

In Slack:
```
/invite @Clive
```

Then:
```
@Clive help me plan a new feature
```

**You're done with Distributed Mode!** 🎉

---

## Testing Your Setup

### Quick Test

1. In any channel with Clive invited, type:
   ```
   @Clive
   ```

2. Clive should respond with a welcome message and ask what you want to build.

3. Answer the questions by:
   - Clicking button options
   - Clicking "Other..." for custom text
   - Replying in the thread

### Full Test Flow

1. Start an interview:
   ```
   @Clive I want to build a user authentication system
   ```

2. Answer 4 phases of questions:
   - **Problem Phase**: What problem are you solving?
   - **Scope Phase**: What's in/out of scope?
   - **Technical Phase**: Technical constraints?
   - **Confirmation Phase**: Review and confirm

3. Review the generated plan

4. Approve to create Linear issues (if Linear MCP is configured)

---

## Troubleshooting

### "Missing required environment variables"

```bash
# Check your .env file exists and has correct values
cat apps/slack/.env

# Ensure no typos in variable names
# SLACK_BOT_TOKEN (not SLACK_TOKEN)
# SLACK_SIGNING_SECRET (not SIGNING_SECRET)
```

### "Request URL verification failed" (Local Mode)

1. Make sure the app is running
2. Check ngrok is connected:
   ```bash
   curl https://your-ngrok-url.ngrok-free.app/slack/events
   ```
3. Verify signing secret matches

### "No workers available" (Distributed Mode)

1. Check at least one worker is connected:
   - Look at central service logs for "Worker registered"
   - Look at worker logs for "Connected to central service"

2. Verify tokens match:
   ```bash
   # Central service .env
   grep CLIVE_WORKER_API_TOKEN apps/slack/.env

   # Worker .env
   grep CLIVE_WORKER_TOKEN apps/worker/.env
   ```

### Bot doesn't respond to @mentions

1. Check bot is invited to channel:
   ```
   /invite @Clive
   ```

2. Check Event Subscriptions has `app_mention` event

3. Check console for errors

### Worker disconnects frequently

1. Check network stability
2. Increase heartbeat timeout if needed:
   ```bash
   export CLIVE_HEARTBEAT_INTERVAL=60000
   ```

### Claude CLI errors

```bash
# Verify Claude CLI works
claude --print "Hello"

# Check authentication
claude whoami

# Re-authenticate if needed
claude login
```

---

## Next Steps

- **Configure Linear MCP**: Enable automatic issue creation
- **Add more workers**: Scale by having more team members run workers
- **Monitor**: Watch central service logs for session activity
- **Customize**: Modify interview prompts in the planning skill

---

## Quick Reference

### Local Mode Commands

```bash
# Start (from monorepo root)
yarn workspace @clive/slack dev

# Type check
yarn workspace @clive/slack typecheck
```

### Distributed Mode Commands

```bash
# Start central service
yarn workspace @clive/slack dev

# Start worker
yarn workspace @clive/worker dev

# Build protocol package
yarn workspace @clive/worker-protocol build
```

### Environment Variables

| Variable | Local | Distributed Central | Distributed Worker |
|----------|-------|--------------------|--------------------|
| `CLIVE_MODE` | `local` | `distributed` | N/A |
| `SLACK_BOT_TOKEN` | ✓ | ✓ | - |
| `SLACK_SIGNING_SECRET` | ✓ | ✓ | - |
| `NGROK_AUTH_TOKEN` | ✓ | - | - |
| `CLIVE_WORKER_API_TOKEN` | - | ✓ | - |
| `CLIVE_WORKER_TOKEN` | - | - | ✓ |
| `CLIVE_CENTRAL_URL` | - | - | ✓ |
| `CLIVE_WORKSPACE_ROOT` | Optional | - | ✓ (or one of below) |
| `CLIVE_WORKSPACE_ROOTS` | - | - | ✓ (comma-separated) |
| `CLIVE_PROJECTS` | - | - | ✓ (JSON config) |

### Project-Based Routing

Workers register their available projects with aliases. The central service routes requests based on project mentions in Slack messages.

**Example Slack mentions:**
- `@clive fix the bug in our frontend app` → Routes to worker with "frontend" project
- `@clive add a new endpoint to the api service` → Routes to worker with "api" project
- `@clive help me plan a feature` → Routes to any available worker

**Worker project configuration:**
```json
[
  {
    "id": "frontend",
    "name": "Frontend App",
    "path": "/path/to/frontend",
    "aliases": ["fe", "web", "client"]
  },
  {
    "id": "api",
    "name": "API Service",
    "path": "/path/to/api",
    "aliases": ["backend", "server"]
  }
]
```
