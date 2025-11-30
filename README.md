# Clive

> Your AI-Powered Cypress Test Writer

Clive is a VS Code extension that helps you set up and manage Cypress end-to-end testing in your projects. It provides an intuitive interface to detect Cypress installations, configure test files, and streamline your E2E testing workflow.

## Features

- 🔍 **Automatic Cypress Detection** - Scans your workspace to detect Cypress installations across multiple packages
- ⚙️ **One-Click Setup** - Automatically configures Cypress in your project with the correct package manager
- 📝 **Config Management** - Updates Cypress configuration files with proper ignore patterns from `.gitignore`
- 🎨 **Modern UI** - Beautiful webview interface built with React and Tailwind CSS
- 🏗️ **Monorepo Support** - Works seamlessly with monorepos and multiple package structures

## Architecture

Clive is built as a monorepo using [Turborepo](https://turborepo.com) and contains:

```
apps
  ├─ extension          # VS Code extension (main product)
  └─ nextjs             # Next.js web application
packages
  ├─ api                # tRPC v11 router definition
  ├─ auth               # Authentication using Better Auth
  ├─ db                 # Database layer with Drizzle ORM & Supabase
  └─ ui                 # Shared UI components (shadcn/ui)
tooling
  ├─ biome              # Shared Biome configuration
  ├─ tailwind           # Shared Tailwind theme and configuration
  └─ typescript         # Shared TypeScript configs
```

## Tech Stack

- **Package Manager**: pnpm with catalog dependencies
- **Build System**: Turborepo
- **Language**: TypeScript
- **Linting/Formatting**: Biome
- **Database**: Supabase Postgres (via Docker Compose)
- **ORM**: Drizzle
- **Auth**: Better Auth
- **API**: tRPC
- **UI**: React, Tailwind CSS v4, shadcn/ui
- **Testing**: Cypress (E2E), Vitest (unit)
- **Functional Programming**: Effect-TS

## Prerequisites

- **Node.js**: `^22.21.0`
- **pnpm**: `^10.19.0`
- **Docker**: For local database (optional)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Setup Local Database (Optional)

Start the Supabase Postgres database using Docker Compose:

```bash
docker-compose up -d
```

This will start a Postgres database on `localhost:5432`. The default connection string is:

```
POSTGRES_URL=postgresql://supabase_admin:your-super-secret-and-long-postgres-password@localhost:5432/postgres
```

You can customize the password by setting the `POSTGRES_PASSWORD` environment variable:

```bash
export POSTGRES_PASSWORD=your-custom-password
docker-compose up -d
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
# Database
POSTGRES_URL=postgresql://supabase_admin:your-super-secret-and-long-postgres-password@localhost:5432/postgres

# Auth (for Next.js app)
AUTH_GITHUB_CLIENT_ID=your-github-client-id
AUTH_GITHUB_CLIENT_SECRET=your-github-client-secret
```

### 4. Setup Database Schema

```bash
# Push the Drizzle schema to the database
pnpm db:push

# Generate Better Auth schema
pnpm auth:generate
```

### 5. Development

```bash
# Start all apps in watch mode
pnpm dev

# Start only Next.js app
pnpm dev:next

# Build all packages
pnpm build

# Run type checking
pnpm typecheck

# Format code
pnpm format:fix

# Lint code
pnpm lint:fix
```

## Development Workflow

### VS Code Extension Development

The extension is located in `apps/extension`. To develop:

1. Open the workspace in VS Code
2. Press `F5` to launch a new Extension Development Host window
3. The extension will be active in the new window

### Adding New Packages

Use Turbo's generator to create new packages:

```bash
pnpm turbo gen init
```

This will set up:
- `package.json` with proper workspace configuration
- `tsconfig.json` extending shared configs
- `biome.json` for linting/formatting
- Proper scripts for build, dev, format, lint, and typecheck

### Adding UI Components

Add new shadcn/ui components using:

```bash
pnpm ui-add
```

This runs the interactive shadcn CLI to add components to the `@clive/ui` package.

## Project Structure

### Extension (`apps/extension`)

- **`src/extension.ts`** - Extension entry point
- **`src/commands/`** - VS Code command handlers
- **`src/services/`** - Business logic (detector, setup, config updater)
- **`src/views/`** - Webview provider
- **`src/webview/`** - React webview UI

### Packages

- **`@clive/api`** - tRPC router definitions
- **`@clive/auth`** - Better Auth configuration and utilities
- **`@clive/db`** - Database schema and Drizzle client
- **`@clive/ui`** - Shared UI components (shadcn/ui)

### Tooling

- **`@clive/biome-config`** - Shared Biome configuration
- **`@clive/tailwind-config`** - Shared Tailwind theme
- **`@clive/tsconfig`** - Shared TypeScript configurations

## Code Quality

### Linting & Formatting

This project uses [Biome](https://biomejs.dev) for both linting and formatting:

```bash
# Check formatting and linting
pnpm format
pnpm lint

# Auto-fix issues
pnpm format:fix
pnpm lint:fix
```

### Type Safety

TypeScript is configured with strict mode. Run type checking:

```bash
pnpm typecheck
```

### Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with commitlint. Commit messages must follow the format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Scopes: `extension`, `webview`, `services`, `commands`, `views`, `docs`, `config`, `build`, `deps`

## Database Management

### Drizzle Studio

Open Drizzle Studio to view and manage your database:

```bash
pnpm db:studio
```

### Schema Changes

After modifying the schema in `packages/db/src/schema.ts`:

```bash
# Push changes to database
pnpm db:push
```

## Docker Compose

The `docker-compose.yml` file provides a local Supabase Postgres instance for development.

### Commands

```bash
# Start database
docker-compose up -d

# Stop database
docker-compose down

# Stop and remove volumes (⚠️ deletes all data)
docker-compose down -v

# View logs
docker-compose logs -f postgres
```

### Connection String

The default connection string format is documented in `docker-compose.yml`. The `drizzle.config.ts` automatically handles port conversion from the pooler port (6543) to the direct port (5432).

## Scripts Reference

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in watch mode |
| `pnpm dev:next` | Start only Next.js app |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm format` | Check code formatting |
| `pnpm format:fix` | Auto-fix formatting issues |
| `pnpm lint` | Check code linting |
| `pnpm lint:fix` | Auto-fix linting issues |
| `pnpm db:push` | Push database schema changes |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm auth:generate` | Generate Better Auth schema |
| `pnpm ui-add` | Add new shadcn/ui component |
| `pnpm clean` | Remove all node_modules |
| `pnpm clean:workspaces` | Clean all workspace node_modules |

## Contributing

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for detailed contribution guidelines.

## Documentation

- [Development Guide](./docs/DEVELOPMENT.md) - Architecture and development patterns
- [Testing Guide](./docs/TESTING.md) - Testing strategies and practices
- [Contributing Guide](./docs/CONTRIBUTING.md) - How to contribute

## License

MIT
