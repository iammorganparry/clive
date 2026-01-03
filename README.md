# Clive

> Your AI-Powered Cypress Test Writer

Clive is a VS Code extension that helps you set up and manage Cypress end-to-end testing in your projects. It provides an intuitive interface to detect Cypress installations, configure test files, and streamline your E2E testing workflow.

## Features

- 🔍 **Automatic Cypress Detection** - Scans your workspace to detect Cypress installations across multiple packages
- ⚙️ **One-Click Setup** - Automatically configures Cypress in your project with the correct package manager
- 📝 **Config Management** - Updates Cypress configuration files with proper ignore patterns from `.gitignore`
- 🎨 **Modern UI** - Beautiful webview interface built with React and Tailwind CSS
- 🏗️ **Monorepo Support** - Works seamlessly with monorepos and multiple package structures

## AI Provider Options

Clive supports multiple AI providers for test generation. Configure your preferred provider in **Settings**.

### Option 1: Clive Gateway (Default)

The easiest option - uses Clive's managed API gateway. Requires a Clive account.

### Option 2: Anthropic API Key

Use your own Anthropic API key for direct API access.

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Go to **Clive Settings** > **API Keys**
3. Enter your Anthropic API key

### Option 3: Claude Code CLI (Use Your Subscription)

Use your existing **Claude Pro** or **Claude Max** subscription - no API charges.

#### Prerequisites

1. **Install Claude Code CLI**
   ```bash
   # macOS/Linux
   curl -fsSL https://claude.ai/install.sh | sh

   # Or via npm
   npm install -g @anthropic-ai/claude-code
   ```

2. **Authenticate with Claude**
   ```bash
   claude login
   ```
   This opens a browser window to authenticate with your Anthropic account.

3. **Verify Installation**
   ```bash
   claude --version
   claude whoami
   ```

#### Configuration in Clive

1. Go to **Clive Settings** > **AI Provider**
2. Select **Claude Code CLI**
3. Clive will auto-detect your CLI installation and authentication status
4. If not authenticated, click **"Login to Claude"** to trigger the auth flow

#### Troubleshooting

| Issue | Solution |
|-------|----------|
| CLI not detected | Ensure `claude` is in your PATH. Try running `which claude` |
| Not authenticated | Run `claude login` in terminal, or click "Login to Claude" in settings |
| Token expired | Re-authenticate with `claude login` |

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

- **Package Manager**: Yarn workspaces
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
- **Yarn**: `^1.22.0`
- **Docker**: For local database (optional)

## Quick Start

### 1. Install Dependencies

```bash
yarn install
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

# Clerk (for VS Code extension)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

### 4. Setup Database Schema

```bash
# Push the Drizzle schema to the database
yarn db:push

# Generate Better Auth schema
yarn auth:generate
```

### 5. Development

```bash
# Start all apps in watch mode
yarn dev

# Start only Next.js app
yarn dev:next

# Build all packages
yarn build

# Run type checking
yarn typecheck

# Format code
yarn format:fix

# Lint code
yarn lint:fix
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
yarn turbo gen init
```

This will set up:
- `package.json` with proper workspace configuration
- `tsconfig.json` extending shared configs
- `biome.json` for linting/formatting
- Proper scripts for build, dev, format, lint, and typecheck

### Adding UI Components

Add new shadcn/ui components using:

```bash
yarn ui-add
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
yarn format
yarn lint

# Auto-fix issues
yarn format:fix
yarn lint:fix
```

### Type Safety

TypeScript is configured with strict mode. Run type checking:

```bash
yarn typecheck
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
yarn db:studio
```

### Schema Changes

After modifying the schema in `packages/db/src/schema.ts`:

```bash
# Push changes to database
yarn db:push
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
| `yarn dev` | Start all apps in watch mode |
| `yarn dev:next` | Start only Next.js app |
| `yarn build` | Build all packages |
| `yarn typecheck` | Run TypeScript type checking |
| `yarn format` | Check code formatting |
| `yarn format:fix` | Auto-fix formatting issues |
| `yarn lint` | Check code linting |
| `yarn lint:fix` | Auto-fix linting issues |
| `yarn db:push` | Push database schema changes |
| `yarn db:studio` | Open Drizzle Studio |
| `yarn auth:generate` | Generate Better Auth schema |
| `yarn ui-add` | Add new shadcn/ui component |
| `yarn clean` | Remove all node_modules |
| `yarn clean:workspaces` | Clean all workspace node_modules |

## Contributing

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for detailed contribution guidelines.

## Documentation

- [Development Guide](./docs/DEVELOPMENT.md) - Architecture and development patterns
- [Testing Guide](./docs/TESTING.md) - Testing strategies and practices
- [Contributing Guide](./docs/CONTRIBUTING.md) - How to contribute

## License

MIT
