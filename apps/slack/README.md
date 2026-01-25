# Clive Slack Integration

> Plan features and create Linear issues via @mention in Slack

This integration allows you to @mention Clive in any Slack channel to conduct planning interviews asynchronously. It replicates the `/clive-plan` workflow through Slack, enabling team collaboration and stakeholder access without requiring terminal access.

## Features

- **@mention to start**: Tag `@clive` in any channel to begin a planning interview
- **Thread-based conversation**: Each interview runs in its own thread
- **Interactive questions**: Answer questions with button clicks or custom text
- **Linear integration**: Automatically creates issues when plan is approved
- **Session management**: 30-minute timeout with resume capability
- **Initiator-only responses**: Only the person who started the interview can answer

## Operation Modes

Clive Slack supports two operation modes:

### Local Mode (Single User)

Each user runs their own Clive backend on their machine. ngrok provides webhook tunneling so Slack can communicate with your local instance.

```
Slack Cloud <--webhook--> ngrok tunnel <--> Your Machine (Clive Slack App)
                                                    |
                                            Claude CLI
                                                    |
                                            Linear API (MCP)
```

**Best for**: Individual developers, personal use, quick setup.

### Distributed Mode (Multi-User / Team)

A central Slack service handles all @mentions and routes work to worker clients running on user machines. Workers connect via WebSocket and execute Claude CLI locally.

```
                         DEPLOYED (stable URL)
    +----------------------------------------------------------+
    |              CENTRAL SLACK SERVICE                       |
    |   Slack Bolt | Worker Registry | Session Router          |
    |                    WebSocket Server                      |
    +-------------------------------------|--------------------+
                                          | WebSocket
    ================ Internet =============|====================
                                          |
    USER TERMINALS (Worker Swarm)         |
    +-------------------------------------|--------------------+
    |   WORKER 1                    WORKER 2                   |
    |   +----------------+          +----------------+         |
    |   | WorkerClient   |          | WorkerClient   |         |
    |   | Claude CLI     |          | Claude CLI     |         |
    |   +----------------+          +----------------+         |
    +----------------------------------------------------------+
```

**Best for**: Teams, shared Slack workspace, multiple concurrent users.

## Prerequisites

- Node.js 18+ or Bun runtime
- Claude CLI installed and authenticated (`claude login`)
- A Slack workspace where you can create apps
- ngrok account (free tier works) - for local mode only

## Quick Start: Local Mode

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it "Clive" and select your workspace
4. Click **Create App**

### 2. Configure OAuth & Permissions

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `app_mentions:read` - Read @mentions
   - `chat:write` - Post messages
   - `channels:history` - Read channel messages (for thread replies)
   - `groups:history` - Read private channel messages
   - `reactions:write` - Add reactions to messages
3. Click **Install to Workspace** at the top
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 3. Enable Event Subscriptions

1. Go to **Event Subscriptions** in the sidebar
2. Toggle **Enable Events** to On
3. For **Request URL**, you'll add the ngrok URL later (after starting the app)
4. Under **Subscribe to bot events**, add:
   - `app_mention` - When someone @mentions your app
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
5. Click **Save Changes**

### 4. Get Your Signing Secret

1. Go to **Basic Information** in the sidebar
2. Under **App Credentials**, copy the **Signing Secret**

### 5. Configure ngrok

1. Sign up at [ngrok.com](https://ngrok.com)
2. Go to [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copy your auth token

### 6. Configure Environment

```bash
cd apps/slack
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Mode: local (default) or distributed
CLIVE_MODE=local

# Slack credentials
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret

# ngrok for local mode
NGROK_AUTH_TOKEN=your-ngrok-auth-token
```

### 7. Start the App

```bash
# From the monorepo root
yarn workspace @clive/slack dev

# Or from this directory
yarn dev
```

You should see output like:
```
Clive Slack app starting...
Configuration loaded successfully
Mode: LOCAL
ngrok tunnel established: https://abc123.ngrok.io

Slack webhook URL: https://abc123.ngrok.io/slack/events

Configure this URL in your Slack app's Event Subscriptions.

Clive Slack app is running on port 3000
Ready to receive @clive mentions!
```

### 8. Complete Event Subscriptions Setup

1. Copy the ngrok URL from the output (e.g., `https://abc123.ngrok.io/slack/events`)
2. Go back to your Slack app's **Event Subscriptions**
3. Paste the URL in the **Request URL** field
4. Wait for the "Verified" checkmark
5. Click **Save Changes**

### 9. Invite Clive to a Channel

In Slack, invite the bot to a channel:
```
/invite @Clive
```

## Quick Start: Distributed Mode

### Central Service Setup

The central service should be deployed to a server with a stable URL (e.g., via Railway, Render, or your own infrastructure).

#### 1. Configure Environment

```bash
CLIVE_MODE=distributed

# Slack credentials (same as local mode)
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret

# Shared secret for worker authentication
CLIVE_WORKER_API_TOKEN=your-secure-shared-secret

# WebSocket path (optional, default: /ws)
CLIVE_WS_PATH=/ws

# Server port
SLACK_PORT=3000
```

#### 2. Deploy the Service

```bash
# Build and start
yarn workspace @clive/slack start
```

The service will log:
```
Clive Slack app starting...
Configuration loaded successfully
Mode: DISTRIBUTED
HTTP server listening on port 3000
WebSocket endpoint: ws://localhost:3000/ws

Waiting for workers to connect...
```

#### 3. Configure Slack Event URL

Point your Slack app's Event Subscriptions to your deployed service URL:
```
https://your-deployed-service.com/slack/events
```

### Worker Setup

Each team member runs a worker client on their machine. See [Worker Setup Guide](../worker/README.md) for details.

Quick start:
```bash
# Set environment variables
export CLIVE_WORKER_TOKEN=your-secure-shared-secret
export CLIVE_CENTRAL_URL=wss://your-deployed-service.com/ws
export CLIVE_WORKSPACE_ROOT=/path/to/your/project

# Start worker
yarn workspace @clive/worker start
```

## Usage

### Starting a Planning Interview

Mention Clive with or without a description:

```
@clive
```
→ Clive will ask what you want to build

```
@clive I want to build a user authentication system with OAuth support
```
→ Clive will start the interview with that context

### Answering Questions

- **Click a button** to select a pre-defined option
- **Click "Other..."** to enter a custom answer
- **Reply in thread** to provide text answers

### Interview Flow

1. **Problem Phase**: Understanding the problem you're solving
2. **Scope Phase**: Defining boundaries and constraints
3. **Technical Phase**: Technical requirements and considerations
4. **Confirmation Phase**: Reviewing and confirming the plan
5. **Issue Creation**: Automatic Linear issue creation (if approved)

### Session Timeout

Interviews timeout after 30 minutes of inactivity. A message will be posted to the thread, and you can start a new interview by mentioning @clive again.

## Troubleshooting

### Local Mode Issues

#### "Request URL verification failed"

- Make sure the app is running and the ngrok tunnel is active
- Verify the URL ends with `/slack/events`
- Check that your signing secret is correct

#### "Missing required environment variables"

- Ensure all required variables are set in `.env`
- Check that there are no typos in variable names
- Make sure the `.env` file is in the `apps/slack` directory

#### Bot doesn't respond to mentions

- Verify the bot is invited to the channel (`/invite @Clive`)
- Check that `app_mentions:read` scope is enabled
- Look at the console output for errors

#### ngrok tunnel disconnects

- Free ngrok accounts get random URLs that change on restart
- Consider upgrading to a paid plan for stable URLs
- The app will need to be restarted if the tunnel disconnects

### Distributed Mode Issues

#### "No workers available"

- Ensure at least one worker is connected to the central service
- Check worker logs for connection errors
- Verify the `CLIVE_WORKER_API_TOKEN` matches between central and workers

#### Worker disconnects frequently

- Check network stability
- Verify WebSocket URL is correct
- Check worker logs for heartbeat failures

#### Interview interrupted by worker disconnect

- The central service will notify users in the Slack thread
- Start a new interview by mentioning @clive again
- Consider running multiple workers for redundancy

### Claude CLI Errors

- Make sure Claude CLI is installed: `which claude`
- Verify authentication: `claude --print "test"`
- Check the console for detailed error messages

## Development

### Project Structure

```
apps/slack/
├── src/
│   ├── index.ts              # App entry point (supports both modes)
│   ├── config/
│   │   └── index.ts          # Configuration loading
│   ├── services/
│   │   ├── slack-service.ts  # Slack API wrapper (Effect-TS)
│   │   ├── claude-manager.ts # Claude CLI bridge (local mode)
│   │   ├── tunnel-service.ts # ngrok management (local mode)
│   │   ├── worker-registry.ts  # Worker tracking (distributed)
│   │   ├── session-router.ts   # Session assignment (distributed)
│   │   └── worker-proxy.ts     # Worker forwarding (distributed)
│   ├── websocket/
│   │   └── event-server.ts   # WebSocket server for workers
│   ├── handlers/
│   │   ├── mention-handler.ts  # @clive events
│   │   ├── message-handler.ts  # Thread replies
│   │   └── action-handler.ts   # Button clicks
│   ├── formatters/
│   │   ├── block-builder.ts    # Slack Block Kit utilities
│   │   └── question-formatter.ts # Question formatting
│   └── store/
│       ├── interview-store.ts  # Session state management
│       └── types.ts            # Type definitions
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Running Tests

```bash
yarn workspace @clive/slack test
```

### Type Checking

```bash
yarn workspace @clive/slack typecheck
```

## Environment Variables Reference

| Variable | Required | Mode | Description |
|----------|----------|------|-------------|
| `CLIVE_MODE` | No | Both | `local` (default) or `distributed` |
| `SLACK_BOT_TOKEN` | Yes | Both | Slack Bot OAuth Token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Yes | Both | Slack app signing secret |
| `NGROK_AUTH_TOKEN` | Yes (local) | Local | ngrok authentication token |
| `CLIVE_WORKER_API_TOKEN` | Yes (distributed) | Distributed | Shared secret for worker auth |
| `CLIVE_WS_PATH` | No | Distributed | WebSocket endpoint path (default: /ws) |
| `SLACK_PORT` | No | Both | Server port (default: 3000) |
| `CLIVE_WORKSPACE` | No | Local | Workspace root for Claude CLI |
| `SESSION_TIMEOUT_MS` | No | Both | Session timeout (default: 30 min) |

## Contributing

See the main [CLAUDE.md](../../CLAUDE.md) for coding standards and patterns.

Key patterns used:
- **Effect-TS** for side effects and error handling
- **Slack Bolt.js** for Slack API interactions
- **Block Kit** for rich message formatting
- **WebSocket** for worker communication (distributed mode)

## License

See the main repository license.
