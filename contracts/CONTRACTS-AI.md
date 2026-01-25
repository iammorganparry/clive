# Contract Definitions

This section describes the contracts in the system that AI agents should be aware of when making changes.

## Quick Reference

| Contract | Type | Location | Key Invariants |
|----------|------|----------|----------------|
| DB.user | table | `packages/db/src/schema.ts` | email must be unique across the system; id is the primary key (text) |
| DB.session | table | `packages/db/src/schema.ts` | - |
| DB.account | table | `packages/db/src/schema.ts` | - |
| DB.organization | table | `packages/db/src/schema.ts` | slug must be unique |
| DB.member | table | `packages/db/src/schema.ts` | users must be members to access organization resources |
| DB.conversation | table | `packages/db/src/schema.ts` | users can only access their own conversations |
| DB.conversationMessage | table | `packages/db/src/schema.ts` | - |
| DB.repositories | table | `packages/db/src/schema.ts` | users can only access their own or organization's repositories |
| DB.files | table | `packages/db/src/schema.ts` | unique constraint on (repositoryId, relativePath) |
| DB.knowledgeBase | table | `packages/db/src/schema.ts` | - |
| repository.upsert | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.get | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.getStatus | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.upsertFile | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.deleteFile | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.deleteFiles | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.getFileByPath | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.getFileHashes | endpoint | `packages/api/src/router/repository.ts` | - |
| repository.searchFiles | endpoint | `packages/api/src/router/repository.ts` | - |
| conversation.create | endpoint | `packages/api/src/router/conversation.ts` | - |
| conversation.getById | endpoint | `packages/api/src/router/conversation.ts` | users can only access their own conversations |
| conversation.getByFile | endpoint | `packages/api/src/router/conversation.ts` | - |
| conversation.getByBranch | endpoint | `packages/api/src/router/conversation.ts` | - |
| conversation.createForBranch | endpoint | `packages/api/src/router/conversation.ts` | - |
| conversation.list | endpoint | `packages/api/src/router/conversation.ts` | - |
| conversation.updateStatus | endpoint | `packages/api/src/router/conversation.ts` | users can only update their own conversations |
| conversation.delete | endpoint | `packages/api/src/router/conversation.ts` | users can only delete their own conversations |
| conversation.addMessage | endpoint | `packages/api/src/router/conversation.ts` | users can only add messages to their own conversations |
| conversation.getMessages | endpoint | `packages/api/src/router/conversation.ts` | users can only read messages from their own conversations |
| auth.getSession | endpoint | `packages/api/src/router/auth.ts` | - |
| auth.getSecretMessage | endpoint | `packages/api/src/router/auth.ts` | requires authentication |
| BetterAuth.github | service | `packages/auth/src/index.ts` | - |
| BetterAuth.jwt | function | `packages/auth/src/index.ts` | - |
| BetterAuth.organization | function | `packages/auth/src/index.ts` | allowUserToCreateOrganization: true; creatorRole: owner |
| BetterAuth.deviceAuthorization | function | `packages/auth/src/index.ts` | - |
| AIGateway.anthropic | service | `apps/extension/src/services/ai-provider-factory.ts` | - |
| AIGateway.openai | service | `apps/extension/src/services/ai-provider-factory.ts` | - |
| AIGateway.xai | service | `apps/extension/src/services/ai-provider-factory.ts` | - |
| ClaudeCLI.execute | service | `apps/extension/src/services/claude-cli-service.ts` | - |
| ClaudeCLI.mcpBridge | endpoint | `apps/extension/src/mcp-server/index.ts` | - |

## Contracts by File

When editing these files, be aware of the following contracts:

### `packages/db/src/schema.ts`

#### DB.user

- **Schema**: `{"table":"user","pk":"id"}`
- **MUST maintain**:
  - ⛔ email must be unique across the system
  - ⛔ id is the primary key (text)
- **Database**: reads: auth (Better Auth), conversation queries, repository queries; writes: auth (Better Auth registration/updates)

#### DB.session

- **Schema**: `{"table":"session","pk":"id","fk":{"userId":"user.id"}}`
- **Database**: reads: auth middleware; writes: auth (login/logout)

#### DB.account

- **Schema**: `{"table":"account","pk":"id","fk":{"userId":"user.id"}}`
- **Database**: reads: auth (OAuth flow); writes: auth (OAuth linking)

#### DB.organization

- **Schema**: `{"table":"organization","pk":"id"}`
- **MUST maintain**:
  - ⛔ slug must be unique
- **Database**: reads: organization queries; writes: organization creation/updates

#### DB.member

- **Schema**: `{"table":"member","pk":"id","fk":{"organizationId":"organization.id","userId":"user.id"}}`
- **MUST maintain**:
  - ⛔ users must be members to access organization resources
- **Database**: reads: organization membership checks; writes: organization member management

#### DB.conversation

- **Schema**: `{"table":"conversation","pk":"id","fk":{"userId":"user.id"}}`
- **MUST maintain**:
  - ⛔ users can only access their own conversations
- **Database**: reads: conversation queries; writes: conversation CRUD operations

#### DB.conversationMessage

- **Schema**: `{"table":"conversation_message","pk":"id","fk":{"conversationId":"conversation.id"}}`
- **Database**: reads: message history queries; writes: message creation

#### DB.repositories

- **Schema**: `{"table":"repositories","pk":"id","fk":{"userId":"user.id","organizationId":"organization.id"}}`
- **MUST maintain**:
  - ⛔ users can only access their own or organization's repositories
- **Database**: reads: repository queries; writes: repository upsert operations

#### DB.files

- **Schema**: `{"table":"files","pk":"id","fk":{"repositoryId":"repositories.id"}}`
- **MUST maintain**:
  - ⛔ unique constraint on (repositoryId, relativePath)
- **Database**: reads: file queries, semantic search; writes: file upsert/delete operations

#### DB.knowledgeBase

- **Schema**: `{"table":"knowledge_base","pk":"id","fk":{"repositoryId":"repositories.id"}}`
- **Database**: reads: knowledge queries, semantic search; writes: knowledge generation/updates

### `packages/api/src/router/repository.ts`

#### repository.upsert

- **Schema**: `{"input":"{name: string, rootPath: string, organizationId?: string}","output":"Repository"}`
- **Database**: writes: repositories

#### repository.get

- **Schema**: `{"input":"{rootPath: string, organizationId?: string}","output":"Repository | null"}`
- **Database**: reads: repositories

#### repository.getStatus

- **Schema**: `{"input":"{rootPath: string, organizationId?: string}","output":"RepositoryStatus"}`
- **Database**: reads: repositories, files

#### repository.upsertFile

- **Schema**: `{"input":"{repositoryId: string, file: FileInput}","output":"{success: boolean}"}`
- **Database**: writes: files

#### repository.deleteFile

- **Schema**: `{"input":"{repositoryId: string, relativePath: string}","output":"{success: boolean}"}`
- **Database**: writes: files

#### repository.deleteFiles

- **Schema**: `{"input":"{repositoryId: string, relativePaths: string[]}","output":"{success: boolean, deletedCount: number}"}`
- **Database**: writes: files

#### repository.getFileByPath

- **Schema**: `{"input":"{repositoryId: string, relativePath: string}","output":"File | null"}`
- **Database**: reads: files

#### repository.getFileHashes

- **Schema**: `{"input":"{repositoryId: string}","output":"FileHash[]"}`
- **Database**: reads: files

#### repository.searchFiles

- **Schema**: `{"input":"{repositoryId: string, queryEmbedding: number[], limit?: number}","output":"SearchResult[]"}`
- **Database**: reads: files

### `packages/api/src/router/conversation.ts`

#### conversation.create

- **Schema**: `{"input":"{sourceFile: string}","output":"Conversation"}`
- **Database**: writes: conversation

#### conversation.getById

- **Schema**: `{"input":"{id: string}","output":"Conversation"}`
- **MUST maintain**:
  - ⛔ users can only access their own conversations
- **Database**: reads: conversation

#### conversation.getByFile

- **Schema**: `{"input":"{sourceFile: string}","output":"Conversation | null"}`
- **Database**: reads: conversation

#### conversation.getByBranch

- **Schema**: `{"input":"{branchName: string, baseBranch?: string, conversationType: 'branch' | 'uncommitted', commitHash?: string}","output":"Conversation | null"}`
- **Database**: reads: conversation

#### conversation.createForBranch

- **Schema**: `{"input":"{branchName: string, baseBranch?: string, sourceFiles: string[], conversationType: 'branch' | 'uncommitted', commitHash?: string}","output":"Conversation"}`
- **Database**: writes: conversation

#### conversation.list

- **Schema**: `{"input":"void","output":"Conversation[]"}`
- **Database**: reads: conversation

#### conversation.updateStatus

- **Schema**: `{"input":"{id: string, status: 'planning' | 'confirmed' | 'completed'}","output":"Conversation"}`
- **MUST maintain**:
  - ⛔ users can only update their own conversations
- **Database**: writes: conversation

#### conversation.delete

- **Schema**: `{"input":"{id: string}","output":"{success: boolean}"}`
- **MUST maintain**:
  - ⛔ users can only delete their own conversations
- **Database**: writes: conversation

#### conversation.addMessage

- **Schema**: `{"input":"{conversationId: string, role: 'user' | 'assistant' | 'system', content: string, toolCalls?: unknown}","output":"Message"}`
- **MUST maintain**:
  - ⛔ users can only add messages to their own conversations
- **Database**: writes: conversationMessage

#### conversation.getMessages

- **Schema**: `{"input":"{conversationId: string}","output":"Message[]"}`
- **MUST maintain**:
  - ⛔ users can only read messages from their own conversations
- **Database**: reads: conversationMessage

### `packages/api/src/router/auth.ts`

#### auth.getSession

- **Schema**: `{"input":"void","output":"{userId: string | null}"}`
- **Database**: reads: session (via context)

#### auth.getSecretMessage

- **Schema**: `{"input":"void","output":"string"}`
- **MUST maintain**:
  - ⛔ requires authentication

### `packages/auth/src/index.ts`

#### BetterAuth.github

- **Database**: reads: user, session, account; writes: user, session, account

#### BetterAuth.jwt

- **Database**: reads: jwks; writes: jwks

#### BetterAuth.organization

- **MUST maintain**:
  - ⛔ allowUserToCreateOrganization: true
  - ⛔ creatorRole: owner
  - ⛔ membershipLimit: 100
- **Database**: reads: organization, member, invitation; writes: organization, member, invitation

#### BetterAuth.deviceAuthorization

- **Database**: reads: deviceCode; writes: deviceCode

### `apps/extension/src/services/ai-provider-factory.ts`

#### AIGateway.anthropic

- **Schema**: `{"modelPrefix":"anthropic/"}`

#### AIGateway.openai

- **Schema**: `{"modelPrefix":"openai/"}`

#### AIGateway.xai

- **Schema**: `{"modelPrefix":"xai/"}`

### `apps/extension/src/services/claude-cli-service.ts`

#### ClaudeCLI.execute

- **Schema**: `{"options":"ClaudeCliExecuteOptions","output":"AsyncGenerator<ClaudeCliEvent>"}`

### `apps/extension/src/mcp-server/index.ts`

#### ClaudeCLI.mcpBridge

