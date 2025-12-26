---
category: "auth-patterns"
title: "Authentication and Authorization Flows"
sourceFiles:
  - packages/auth/src/index.ts
  - apps/extension/src/rpc/routers/auth.ts
  - packages/db/src/schema.ts
updatedAt: "2025-12-26"
---

User authentication using Better Auth with OAuth providers and session management. Authorization controls access to resources based on user roles and ownership.

### Context for Testing
Authentication flows require testing of login/logout, session persistence, and access control. Mock auth services while validating security boundaries.

### Overview
Implements Better Auth for user management with GitHub/Discord OAuth, session cookies, and organization-based access control. Protects API endpoints with authentication middleware.

### Authentication Flow
1. User initiates OAuth login
2. Provider redirects with authorization code
3. Server exchanges code for access token
4. User session created with JWT/cookies
5. Subsequent requests include session data

### Authorization Patterns
- User-based resource ownership
- Organization membership validation
- Role-based permissions (owner/admin/member)
- API procedure guards

### Code Examples
```typescript
// Auth configuration
export const auth = betterAuth({
  database: db,
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET
    }
  },
  session: {
    cookie: true,
    expiresIn: 3600
  }
});

// Protected procedure
const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next();
});
```

### Usage Patterns
- Session validation on API calls
- User context injection in procedures
- Organization-based data filtering
- Secure cookie handling

### Test Implications
- Mock auth providers for login testing
- Test session persistence across requests
- Validate authorization guards
- Test organization permission logic
- Integration tests for OAuth flows

### Edge Cases
- Session expiration handling
- Invalid OAuth tokens
- User account suspension
- Organization membership changes
- Concurrent session management

### Related Patterns
- See 'External Services' for auth providers
- Links to 'Database Patterns' for user storage
- 'RPC System' for protected procedures

## Examples

### Example

```typescript
export const auth = betterAuth({ ... });
```

### Example

```typescript
const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => { ... });
```

### Example

```typescript
if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
```


## Source Files

- `packages/auth/src/index.ts`
- `apps/extension/src/rpc/routers/auth.ts`
- `packages/db/src/schema.ts`
