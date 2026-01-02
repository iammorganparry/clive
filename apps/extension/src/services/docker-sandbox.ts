import { Effect, Data } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { VSCodeService } from "./vs-code.js";

const execAsync = promisify(exec);

class DockerError extends Data.TaggedError("DockerError")<{
  message: string;
  cause?: unknown;
}> {}

class DockerNotAvailableError extends Data.TaggedError(
  "DockerNotAvailableError",
)<{
  message: string;
}> {}

export class DockerSandboxService extends Effect.Service<DockerSandboxService>()(
  "DockerSandboxService",
  {
    effect: Effect.gen(function* () {
      const vsCodeService = yield* VSCodeService;
      const isDockerAvailable = () =>
        Effect.tryPromise({
          try: () => execAsync("docker --version"),
          catch: () =>
            new DockerNotAvailableError({
              message:
                "Docker is not available. Please install Docker to run integration tests.",
            }),
        }).pipe(Effect.map(() => true));

      const start = (composeFile?: string) =>
        Effect.gen(function* () {
          const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();
          const cwd = workspaceRoot.fsPath;

          yield* isDockerAvailable();

          const composeArg = composeFile ? `-f ${composeFile}` : "";
          const command = `docker-compose ${composeArg} up -d`;

          yield* Effect.logDebug(
            `[DockerSandbox] Starting services: ${command}`,
          );

          yield* Effect.tryPromise({
            try: () => execAsync(command, { cwd, timeout: 60_000 }),
            catch: (error) =>
              new DockerError({
                message: `Failed to start Docker services: ${error instanceof Error ? error.message : "Unknown"}`,
                cause: error,
              }),
          });

          yield* Effect.logDebug("[DockerSandbox] Services started");
        });

      const stop = (composeFile?: string) =>
        Effect.gen(function* () {
          const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();
          const cwd = workspaceRoot.fsPath;

          const composeArg = composeFile ? `-f ${composeFile}` : "";
          const command = `docker-compose ${composeArg} down`;

          yield* Effect.logDebug(
            `[DockerSandbox] Stopping services: ${command}`,
          );

          yield* Effect.tryPromise({
            try: () => execAsync(command, { cwd, timeout: 30_000 }),
            catch: (error) =>
              new DockerError({
                message: `Failed to stop Docker services: ${error instanceof Error ? error.message : "Unknown"}`,
                cause: error,
              }),
          });
        });

      const waitForHealth = (maxWaitMs = 30_000) =>
        Effect.gen(function* () {
          const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();
          const cwd = workspaceRoot.fsPath;

          yield* Effect.logDebug(
            "[DockerSandbox] Waiting for services to be healthy...",
          );

          const startTime = Date.now();

          yield* Effect.iterate(false, {
            while: (healthy) => !healthy && Date.now() - startTime < maxWaitMs,
            body: () =>
              Effect.tryPromise({
                try: async () => {
                  const { stdout } = await execAsync(
                    "docker-compose ps --format json",
                    { cwd },
                  );
                  const services = stdout.trim().split("\n").filter(Boolean);
                  return services.every(
                    (s) => s.includes('"running"') || s.includes('"healthy"'),
                  );
                },
                catch: () =>
                  new DockerError({
                    message: "Failed to check service health",
                  }),
              }).pipe(
                Effect.flatMap((healthy) =>
                  healthy
                    ? Effect.succeed(true)
                    : Effect.sleep("1 second").pipe(Effect.map(() => false)),
                ),
              ),
          });

          yield* Effect.logDebug("[DockerSandbox] All services healthy");
        });

      const loadSandboxEnv = () =>
        Effect.gen(function* () {
          const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();

          const envTestUri = vsCodeService.joinPath(
            workspaceRoot,
            ".clive",
            ".env.test",
          );
          const envContent = yield* vsCodeService
            .readFileAsString(envTestUri)
            .pipe(Effect.catchAll(() => Effect.succeed("")));

          if (!envContent) {
            yield* Effect.logDebug(
              "[DockerSandbox] No .clive/.env.test found - agent should create one",
            );
            return { NODE_ENV: "test" };
          }

          const sandboxEnv: Record<string, string> = {
            NODE_ENV: "test",
          };

          for (const line of envContent.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;

            const eqIndex = trimmed.indexOf("=");
            if (eqIndex > 0) {
              const key = trimmed.slice(0, eqIndex).trim();
              const value = trimmed.slice(eqIndex + 1).trim();
              sandboxEnv[key] = value.replace(/^["']|["']$/g, "");
            }
          }

          yield* Effect.logDebug(
            `[DockerSandbox] Loaded sandbox env from .clive/.env.test: ${Object.keys(sandboxEnv).join(", ")}`,
          );

          return sandboxEnv;
        });

      return {
        isDockerAvailable,
        start,
        stop,
        waitForHealth,
        loadSandboxEnv,
      };
    }),
  },
) {}

export const DockerSandboxServiceLive = DockerSandboxService.Default;

export { DockerError, DockerNotAvailableError };
