# Environment Variables Migration Guide

## Removed Variables

Remove these Clerk-related environment variables from your `.env` files:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` (optional)
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL` (optional)
- `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` (optional)
- `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` (optional)

## Required New Variables

Add these Better Auth environment variables to your `.env` files:

```bash
# Better Auth Configuration
BETTER_AUTH_SECRET=<generate-random-secret>
BETTER_AUTH_URL=http://localhost:3000

# GitHub OAuth Configuration
GITHUB_CLIENT_ID=<your-github-client-id>
GITHUB_CLIENT_SECRET=<your-github-client-secret>
```

### Generating BETTER_AUTH_SECRET

You can generate a secure random secret using:

```bash
openssl rand -base64 32
```

Or use an online generator: https://generate-secret.vercel.app/32

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set the Authorization callback URL to: `http://localhost:3000/api/auth/callback/github`
4. For production, update the callback URL to your production domain
5. Copy the Client ID and Client Secret to your `.env` file

**Important**: Make sure to include the `user:email` scope in your GitHub app settings.
