# Database Schema Migration Guide

## Running the Migration

After installing Better Auth, you need to generate and run database migrations to create the required auth tables.

### Option 1: Using Better Auth CLI (Recommended)

1. Generate the schema:

```bash
npx @better-auth/cli@latest generate
```

2. Generate Drizzle migration:

```bash
npx drizzle-kit generate
```

3. Apply the migration:

```bash
npx drizzle-kit migrate
```

### Option 2: Manual Migration

The schema has been manually added to `packages/db/src/schema.ts`. You can generate and apply migrations using:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

## Tables Created

The migration creates the following tables:

- `user` - Stores user account information
- `session` - Stores user session data
- `account` - Stores OAuth account information (GitHub, etc.)
- `verification` - Stores email verification tokens

## Notes

- All tables use UUID primary keys by default
- Foreign key relationships are set up with cascade deletes
- Timestamps are automatically managed with `created_at` and `updated_at` fields
