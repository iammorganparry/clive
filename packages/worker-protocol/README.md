# @clive/worker-protocol

> Shared protocol types for Clive distributed worker architecture

This package provides TypeScript type definitions and Zod validation schemas for communication between the central Clive Slack service and distributed worker clients.

## Installation

This package is internal to the Clive monorepo. It's automatically linked via yarn workspaces.

```bash
# From monorepo root
yarn install

# Build the package
yarn workspace @clive/worker-protocol build
```

## Usage

### TypeScript Types

```typescript
import type {
  WorkerRegistration,
  InterviewRequest,
  InterviewEvent,
  CentralToWorkerMessage,
  WorkerToCentralMessage,
} from "@clive/worker-protocol";

// Worker registration
const registration: WorkerRegistration = {
  workerId: "worker-abc123",
  apiToken: "secret-token",
  workspaceRoot: "/path/to/workspace",
  hostname: "my-machine",
};

// Interview request from central to worker
const request: InterviewRequest = {
  sessionId: "thread-123",
  threadTs: "1234567890.123456",
  channel: "C12345678",
  initiatorId: "U12345678",
  initialPrompt: "Build a login feature",
};

// Interview event from worker to central
const event: InterviewEvent = {
  sessionId: "thread-123",
  type: "question",
  payload: {
    type: "question",
    data: {
      toolUseID: "tool-123",
      questions: [
        {
          header: "Feature Type",
          question: "What type of login do you need?",
          options: [
            { label: "OAuth", description: "Social login" },
            { label: "Email/Password", description: "Traditional login" },
          ],
          multiSelect: false,
        },
      ],
    },
  },
  timestamp: new Date().toISOString(),
};
```

### Zod Validation

```typescript
import {
  CentralToWorkerMessageSchema,
  WorkerToCentralMessageSchema,
} from "@clive/worker-protocol";

// Validate incoming message from central service
const parseResult = CentralToWorkerMessageSchema.safeParse(incomingData);
if (parseResult.success) {
  const message = parseResult.data;
  switch (message.type) {
    case "start_interview":
      // message.payload is typed as InterviewRequest
      break;
    case "answer":
      // message.payload is typed as AnswerRequest
      break;
  }
} else {
  console.error("Invalid message:", parseResult.error);
}
```

## Type Reference

### Core Types

| Type | Description |
|------|-------------|
| `WorkerStatus` | Worker state: `connecting`, `ready`, `busy`, `disconnected` |
| `InterviewPhase` | Interview phase: `problem`, `scope`, `technical`, etc. |
| `QuestionData` | AskUserQuestion tool payload with questions and options |

### Registration Types

| Type | Description |
|------|-------------|
| `WorkerRegistration` | Worker registration request |
| `WorkerRegistrationResponse` | Central service response with WebSocket URL |
| `WorkerHeartbeat` | Periodic status update from worker |
| `NgrokConfig` | Optional ngrok tunnel configuration |

### Interview Types

| Type | Description |
|------|-------------|
| `InterviewRequest` | Request to start an interview |
| `InterviewEvent` | Event from worker during interview |
| `InterviewEventPayload` | Discriminated union of event payloads |
| `AnswerRequest` | Answer to forward to worker |
| `MessageRequest` | Follow-up message to forward |
| `CancelRequest` | Session cancellation request |

### WebSocket Message Types

| Type | Description |
|------|-------------|
| `CentralToWorkerMessage` | Messages from central service to worker |
| `WorkerToCentralMessage` | Messages from worker to central service |

### HTTP API Types

| Type | Description |
|------|-------------|
| `RegisterWorkerRequest` | POST /api/workers/register request |
| `RegisterWorkerResponse` | Registration response |
| `ListWorkersResponse` | GET /api/workers response |
| `WorkerInfo` | Worker summary for listings |
| `SessionInfo` | Session summary |

## Protocol Flow

### Worker Registration

```
Worker                          Central Service
  |                                    |
  |------ WebSocket Connect ---------->|
  |                                    |
  |------ { type: "register",          |
  |         payload: WorkerRegistration }
  |                                    |
  |<----- Connection Accepted ---------|
  |                                    |
  |------ { type: "heartbeat", ... } ->|  (every 30s)
  |                                    |
```

### Interview Flow

```
Slack       Central Service           Worker
  |                |                    |
  |-- @mention --->|                    |
  |                |-- start_interview ->|
  |                |                    |
  |                |<-- event (question) |
  |<-- Question ---|                    |
  |                |                    |
  |-- Answer ----->|                    |
  |                |-- answer --------->|
  |                |                    |
  |                |<-- event (complete) |
  |<-- Done -------|                    |
```

## Building

```bash
# Build TypeScript to JavaScript + declarations
yarn workspace @clive/worker-protocol build

# Type check without emitting
yarn workspace @clive/worker-protocol typecheck

# Clean build output
yarn workspace @clive/worker-protocol clean
```

## Related Documentation

- [Slack Integration](../../apps/slack/README.md) - Central service documentation
- [Worker Client](../../apps/worker/README.md) - Worker client documentation

## License

See the main repository license.
