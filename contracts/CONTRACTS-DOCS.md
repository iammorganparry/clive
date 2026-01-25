# System Contracts Documentation

Generated: 2026-01-25T13:42:48.805Z

## Summary

- **Total Contracts**: 40
- **Total Relationships**: 0

## Tables

### DB.user

**Location**: `packages/db/src/schema.ts:36`

**Schema**:
```json
{
  "table": "user",
  "pk": "id"
}
```

**Invariants**:
- 🔴 email must be unique across the system
- 🔴 id is the primary key (text)

---

### DB.session

**Location**: `packages/db/src/schema.ts:49`

**Schema**:
```json
{
  "table": "session",
  "pk": "id",
  "fk": {
    "userId": "user.id"
  }
}
```

---

### DB.account

**Location**: `packages/db/src/schema.ts:66`

**Schema**:
```json
{
  "table": "account",
  "pk": "id",
  "fk": {
    "userId": "user.id"
  }
}
```

---

### DB.organization

**Location**: `packages/db/src/schema.ts:109`

**Schema**:
```json
{
  "table": "organization",
  "pk": "id"
}
```

**Invariants**:
- 🔴 slug must be unique

---

### DB.member

**Location**: `packages/db/src/schema.ts:118`

**Schema**:
```json
{
  "table": "member",
  "pk": "id",
  "fk": {
    "organizationId": "organization.id",
    "userId": "user.id"
  }
}
```

**Invariants**:
- 🔴 users must be members to access organization resources

---

### DB.conversation

**Location**: `packages/db/src/schema.ts:192`

**Schema**:
```json
{
  "table": "conversation",
  "pk": "id",
  "fk": {
    "userId": "user.id"
  }
}
```

**Invariants**:
- 🔴 users can only access their own conversations

---

### DB.conversationMessage

**Location**: `packages/db/src/schema.ts:213`

**Schema**:
```json
{
  "table": "conversation_message",
  "pk": "id",
  "fk": {
    "conversationId": "conversation.id"
  }
}
```

---

### DB.repositories

**Location**: `packages/db/src/schema.ts:225`

**Schema**:
```json
{
  "table": "repositories",
  "pk": "id",
  "fk": {
    "userId": "user.id",
    "organizationId": "organization.id"
  }
}
```

**Invariants**:
- 🔴 users can only access their own or organization's repositories

---

### DB.files

**Location**: `packages/db/src/schema.ts:243`

**Schema**:
```json
{
  "table": "files",
  "pk": "id",
  "fk": {
    "repositoryId": "repositories.id"
  }
}
```

**Invariants**:
- 🔴 unique constraint on (repositoryId, relativePath)

---

### DB.knowledgeBase

**Location**: `packages/db/src/schema.ts:272`

**Schema**:
```json
{
  "table": "knowledge_base",
  "pk": "id",
  "fk": {
    "repositoryId": "repositories.id"
  }
}
```

---

## Endpoints

### repository.upsert

**Location**: `packages/api/src/router/repository.ts:14`

**Schema**:
```json
{
  "input": "{name: string, rootPath: string, organizationId?: string}",
  "output": "Repository"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.get

**Location**: `packages/api/src/router/repository.ts:49`

**Schema**:
```json
{
  "input": "{rootPath: string, organizationId?: string}",
  "output": "Repository | null"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.getStatus

**Location**: `packages/api/src/router/repository.ts:82`

**Schema**:
```json
{
  "input": "{rootPath: string, organizationId?: string}",
  "output": "RepositoryStatus"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.upsertFile

**Location**: `packages/api/src/router/repository.ts:115`

**Schema**:
```json
{
  "input": "{repositoryId: string, file: FileInput}",
  "output": "{success: boolean}"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.deleteFile

**Location**: `packages/api/src/router/repository.ts:151`

**Schema**:
```json
{
  "input": "{repositoryId: string, relativePath: string}",
  "output": "{success: boolean}"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.deleteFiles

**Location**: `packages/api/src/router/repository.ts:181`

**Schema**:
```json
{
  "input": "{repositoryId: string, relativePaths: string[]}",
  "output": "{success: boolean, deletedCount: number}"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.getFileByPath

**Location**: `packages/api/src/router/repository.ts:211`

**Schema**:
```json
{
  "input": "{repositoryId: string, relativePath: string}",
  "output": "File | null"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.getFileHashes

**Location**: `packages/api/src/router/repository.ts:243`

**Schema**:
```json
{
  "input": "{repositoryId: string}",
  "output": "FileHash[]"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### repository.searchFiles

**Location**: `packages/api/src/router/repository.ts:271`

**Schema**:
```json
{
  "input": "{repositoryId: string, queryEmbedding: number[], limit?: number}",
  "output": "SearchResult[]"
}
```

**Possible Errors**:
- `RepositoryError -> INTERNAL_SERVER_ERROR`

---

### conversation.create

**Location**: `packages/api/src/router/conversation.ts:17`

**Schema**:
```json
{
  "input": "{sourceFile: string}",
  "output": "Conversation"
}
```

**Possible Errors**:
- `ConversationError -> INTERNAL_SERVER_ERROR`

---

### conversation.getById

**Location**: `packages/api/src/router/conversation.ts:41`

**Schema**:
```json
{
  "input": "{id: string}",
  "output": "Conversation"
}
```

**Invariants**:
- 🔴 users can only access their own conversations

**Possible Errors**:
- `ConversationNotFoundError -> NOT_FOUND`
- `ConversationError -> INTERNAL_SERVER_ERROR`
- `ownership violation -> FORBIDDEN`

---

### conversation.getByFile

**Location**: `packages/api/src/router/conversation.ts:83`

**Schema**:
```json
{
  "input": "{sourceFile: string}",
  "output": "Conversation | null"
}
```

**Possible Errors**:
- `ConversationError -> INTERNAL_SERVER_ERROR`

---

### conversation.getByBranch

**Location**: `packages/api/src/router/conversation.ts:107`

**Schema**:
```json
{
  "input": "{branchName: string, baseBranch?: string, conversationType: 'branch' | 'uncommitted', commitHash?: string}",
  "output": "Conversation | null"
}
```

**Possible Errors**:
- `ConversationError -> INTERNAL_SERVER_ERROR`

---

### conversation.createForBranch

**Location**: `packages/api/src/router/conversation.ts:144`

**Schema**:
```json
{
  "input": "{branchName: string, baseBranch?: string, sourceFiles: string[], conversationType: 'branch' | 'uncommitted', commitHash?: string}",
  "output": "Conversation"
}
```

**Possible Errors**:
- `ConversationError -> INTERNAL_SERVER_ERROR`

---

### conversation.list

**Location**: `packages/api/src/router/conversation.ts:183`

**Schema**:
```json
{
  "input": "void",
  "output": "Conversation[]"
}
```

**Possible Errors**:
- `ConversationError -> INTERNAL_SERVER_ERROR`

---

### conversation.updateStatus

**Location**: `packages/api/src/router/conversation.ts:205`

**Schema**:
```json
{
  "input": "{id: string, status: 'planning' | 'confirmed' | 'completed'}",
  "output": "Conversation"
}
```

**Invariants**:
- 🔴 users can only update their own conversations

**Possible Errors**:
- `ConversationNotFoundError -> NOT_FOUND`
- `ConversationError -> INTERNAL_SERVER_ERROR`
- `ownership violation -> FORBIDDEN`

---

### conversation.delete

**Location**: `packages/api/src/router/conversation.ts:275`

**Schema**:
```json
{
  "input": "{id: string}",
  "output": "{success: boolean}"
}
```

**Invariants**:
- 🔴 users can only delete their own conversations

**Possible Errors**:
- `ConversationNotFoundError -> NOT_FOUND`
- `ConversationError -> INTERNAL_SERVER_ERROR`
- `ownership violation -> FORBIDDEN`

---

### conversation.addMessage

**Location**: `packages/api/src/router/conversation.ts:334`

**Schema**:
```json
{
  "input": "{conversationId: string, role: 'user' | 'assistant' | 'system', content: string, toolCalls?: unknown}",
  "output": "Message"
}
```

**Invariants**:
- 🔴 users can only add messages to their own conversations

**Possible Errors**:
- `ConversationNotFoundError -> NOT_FOUND`
- `MessageError -> INTERNAL_SERVER_ERROR`
- `ownership violation -> FORBIDDEN`

---

### conversation.getMessages

**Location**: `packages/api/src/router/conversation.ts:403`

**Schema**:
```json
{
  "input": "{conversationId: string}",
  "output": "Message[]"
}
```

**Invariants**:
- 🔴 users can only read messages from their own conversations

**Possible Errors**:
- `ConversationNotFoundError -> NOT_FOUND`
- `MessageError -> INTERNAL_SERVER_ERROR`
- `ownership violation -> FORBIDDEN`

---

### auth.getSession

**Location**: `packages/api/src/router/auth.ts:6`

**Schema**:
```json
{
  "input": "void",
  "output": "{userId: string | null}"
}
```

---

### auth.getSecretMessage

**Location**: `packages/api/src/router/auth.ts:11`

**Schema**:
```json
{
  "input": "void",
  "output": "string"
}
```

**Invariants**:
- 🔴 requires authentication

---

### ClaudeCLI.mcpBridge

**Location**: `apps/extension/src/mcp-server/index.ts`

---

## Services

### BetterAuth.github

**Location**: `packages/auth/src/index.ts:49`

---

### AIGateway.anthropic

**Location**: `apps/extension/src/services/ai-provider-factory.ts:79`

**Schema**:
```json
{
  "modelPrefix": "anthropic/"
}
```

---

### AIGateway.openai

**Location**: `apps/extension/src/services/ai-provider-factory.ts:40`

**Schema**:
```json
{
  "modelPrefix": "openai/"
}
```

---

### AIGateway.xai

**Location**: `apps/extension/src/services/ai-provider-factory.ts:113`

**Schema**:
```json
{
  "modelPrefix": "xai/"
}
```

---

### ClaudeCLI.execute

**Location**: `apps/extension/src/services/claude-cli-service.ts`

**Schema**:
```json
{
  "options": "ClaudeCliExecuteOptions",
  "output": "AsyncGenerator<ClaudeCliEvent>"
}
```

---

## Functions

### BetterAuth.jwt

**Location**: `packages/auth/src/index.ts:56`

---

### BetterAuth.organization

**Location**: `packages/auth/src/index.ts:59`

**Invariants**:
- 🔴 allowUserToCreateOrganization: true
- 🔴 creatorRole: owner
- 🔴 membershipLimit: 100

---

### BetterAuth.deviceAuthorization

**Location**: `packages/auth/src/index.ts:64`

---
