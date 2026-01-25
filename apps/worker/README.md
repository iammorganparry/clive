# Clive Worker

> Distributed worker client for Clive Slack integration

The Clive Worker is a client application that connects to the Clive central Slack service and executes Claude CLI interviews locally. This enables team members to participate in the distributed architecture while using their own Claude CLI authentication and local workspace access.

## Overview

In the distributed architecture, the worker:
1. Connects to the central Slack service via WebSocket
2. Receives interview requests when @clive is mentioned in Slack
3. Executes Claude CLI locally to run the planning interview
4. Streams events back to the central service for Slack display
5. Handles answers forwarded from Slack users

```
Central Service <--WebSocket--> Worker Client <--> Claude CLI
                                                        |
                                                Local Workspace
                                                        |
                                                Linear API (MCP)
```

## Prerequisites

- Node.js 18+
- Claude CLI installed and authenticated (`claude login`)
- Access to the central Clive Slack service
- Worker API token from your team admin

## Quick Start

### 1. Install Dependencies

```bash
# From the monorepo root
yarn install

# Or build specifically
yarn workspace @clive/worker-protocol build
```

### 2. Configure Environment

Create a `.env` file or export environment variables:

```bash
# Required: API token matching the central service
export CLIVE_WORKER_TOKEN=your-shared-secret-token

# Required: WebSocket URL of the central service
export CLIVE_CENTRAL_URL=wss://your-central-service.com/ws

# Optional: Workspace root directory (default: current directory)
export CLIVE_WORKSPACE_ROOT=/path/to/your/project
```

### 3. Start the Worker

```bash
# From the monorepo root
yarn workspace @clive/worker start

# Or in development mode with auto-reload
yarn workspace @clive/worker dev
```

You should see:
```
Clive Worker starting...

Configuration:
  Central URL: wss://your-central-service.com/ws
  Workspace:   /path/to/your/project
  Hostname:    your-machine.local

Connected to central service
Worker worker-abc12345 is ready
Waiting for interview requests...
```

## How It Works

### Connection Flow

1. Worker connects to central service via WebSocket
2. Worker sends registration message with API token
3. Central service validates token and adds worker to registry
4. Worker sends heartbeats every 30 seconds to maintain connection

### Interview Flow

1. User mentions @clive in Slack
2. Central service assigns the interview to an available worker
3. Worker receives `start_interview` message
4. Worker spawns Claude CLI with the planning skill
5. Claude asks questions → Worker sends events → Central posts to Slack
6. User answers in Slack → Central forwards to Worker → Worker sends to Claude
7. Interview completes → Worker sends completion event → Session closed

### Reconnection

If the connection drops, the worker will:
1. Attempt to reconnect with exponential backoff
2. Re-register with the central service
3. Resume handling new interview requests

Active interviews at the time of disconnect will fail, and users will be notified in Slack.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLIVE_WORKER_TOKEN` | Yes | - | API token for central service authentication |
| `CLIVE_CENTRAL_URL` | Yes | - | WebSocket URL of central service (wss://...) |
| `CLIVE_WORKSPACE_ROOT` | No | `cwd()` | Single workspace root (simplest option) |
| `CLIVE_WORKSPACE_ROOTS` | No | - | Comma-separated paths for multiple projects |
| `CLIVE_PROJECTS` | No | - | JSON array with full project metadata |
| `CLIVE_PROJECTS_FILE` | No | - | Path to JSON file with project config |
| `CLIVE_DEFAULT_PROJECT` | No | First project | Default project ID when none specified |
| `CLIVE_WORKER_HOSTNAME` | No | OS hostname | Worker identifier for debugging |
| `CLIVE_HEARTBEAT_INTERVAL` | No | 30000 | Heartbeat interval in milliseconds |
| `CLIVE_RECONNECT_DELAY` | No | 5000 | Initial reconnect delay in milliseconds |
| `CLIVE_MAX_RECONNECT_ATTEMPTS` | No | 10 | Max reconnection attempts before giving up |

### Project Configuration

Workers register their available projects with the central service. When a user mentions @clive with a project reference (e.g., "@clive fix the bug in our marketing app"), the router matches the request to a worker that has access to that project.

#### Method 1: Single Workspace (Simplest)

```bash
CLIVE_WORKSPACE_ROOT=/path/to/your/project
```

#### Method 2: Multiple Workspaces

```bash
CLIVE_WORKSPACE_ROOTS=/path/to/marketing-app,/path/to/api-service
```

Project IDs and names are derived from folder names.

#### Method 3: Full JSON Configuration

```bash
CLIVE_PROJECTS='[
  {"id":"marketing","name":"Marketing App","path":"/path/to/marketing-app","aliases":["mktg","marketing-frontend"],"description":"Main marketing website"},
  {"id":"api","name":"API Service","path":"/path/to/api-service","aliases":["backend"]}
]'
```

#### Method 4: JSON Config File

```bash
CLIVE_PROJECTS_FILE=/path/to/projects.json
```

File format:
```json
[
  {
    "id": "marketing",
    "name": "Marketing App",
    "path": "/path/to/marketing-app",
    "aliases": ["mktg", "marketing-frontend"],
    "description": "Main marketing website"
  },
  {
    "id": "api",
    "name": "API Service",
    "path": "/path/to/api-service"
  }
]
```

### Project Matching

The central service matches Slack requests to workers using:
1. **Project ID** - Exact match (e.g., "marketing")
2. **Project Name** - Case-insensitive match (e.g., "Marketing App")
3. **Aliases** - Any registered alias (e.g., "mktg")
4. **Partial Match** - Name contains query (e.g., "marketing" matches "Marketing App")

If no project match is found, the request goes to the least busy available worker.

### Example .env File

```bash
# Authentication
CLIVE_WORKER_TOKEN=abc123def456...

# Central service
CLIVE_CENTRAL_URL=wss://clive-central.example.com/ws

# Projects (choose one method)
# Simple: single project
CLIVE_WORKSPACE_ROOT=/Users/me/projects/myapp

# OR multiple projects
# CLIVE_WORKSPACE_ROOTS=/Users/me/projects/frontend,/Users/me/projects/backend

# OR full JSON config
# CLIVE_PROJECTS='[{"id":"frontend","name":"Frontend App","path":"/Users/me/projects/frontend","aliases":["fe","web"]}]'

# Optional: default project when none specified
CLIVE_DEFAULT_PROJECT=frontend

# Optional tuning
CLIVE_HEARTBEAT_INTERVAL=30000
CLIVE_RECONNECT_DELAY=5000
CLIVE_MAX_RECONNECT_ATTEMPTS=10
```

## Project Structure

```
apps/worker/
├── src/
│   ├── index.ts           # Entry point, CLI setup
│   ├── config.ts          # Environment configuration
│   ├── worker-client.ts   # WebSocket client, message routing
│   ├── local-executor.ts  # Claude CLI execution wrapper
│   └── tunnel-manager.ts  # Optional ngrok tunnel management
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Development

### Type Checking

```bash
yarn workspace @clive/worker typecheck
```

### Building

```bash
yarn workspace @clive/worker build
```

### Running in Development

```bash
# With auto-reload on file changes
yarn workspace @clive/worker dev
```

## Troubleshooting

### "CLIVE_WORKER_TOKEN environment variable is required"

Make sure you've set the token either:
- In a `.env` file in the worker directory
- As an environment variable: `export CLIVE_WORKER_TOKEN=...`

### "WebSocket connection failed"

- Verify the `CLIVE_CENTRAL_URL` is correct (should start with `wss://` or `ws://`)
- Check that the central service is running and accessible
- Verify network/firewall allows WebSocket connections

### "Worker disconnected" / Reconnection loops

- Check network stability
- Verify the API token matches the central service configuration
- Look at central service logs for authentication errors

### "Claude CLI not found"

- Ensure Claude CLI is installed: `which claude`
- Verify it's in your PATH
- Run `claude --version` to confirm it works

### Interview fails immediately

- Check that you're authenticated: `claude whoami`
- Verify the workspace root exists and contains relevant project files
- Check worker logs for detailed error messages

## Security Considerations

- **API Token**: Keep the `CLIVE_WORKER_TOKEN` secret. It authenticates your worker to the central service.
- **Workspace Access**: The worker has access to your local filesystem. Ensure the workspace root is appropriate.
- **Claude Authentication**: The worker uses your local Claude CLI authentication. Your Claude account is used for interviews.

## Related Documentation

- [Slack Integration Guide](../slack/README.md) - Central service setup
- [Worker Protocol Package](../../packages/worker-protocol/README.md) - Protocol types and schemas
- [Main Project CLAUDE.md](../../CLAUDE.md) - Coding standards and patterns

## License

See the main repository license.
