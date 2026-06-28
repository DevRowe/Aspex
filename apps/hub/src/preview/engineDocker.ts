import { randomUUID } from "node:crypto";
import { createConnection, createServer } from "node:net";
import type { PreviewSpec } from "@aspex/schema";
import type { ExitInfo, PreviewEngine, PreviewHandle } from "./engine";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;
const DOCKER_NAME_PREFIX = "aspex-preview-";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface CommandOptions {
  timeoutMs?: number | null;
  env?: Record<string, string>;
}

type CommandRunner = (
  args: string[],
  opts?: CommandOptions,
) => Promise<CommandResult>;

interface DockerEngineOptions {
  pull?: boolean;
  commandTimeoutMs?: number;
  readyTimeoutMs?: number;
  runner?: CommandRunner;
  idFactory?: () => string;
}

interface DockerPreviewHandle extends PreviewHandle {
  fireExit(info: ExitInfo): void;
  isStopped(): boolean;
}

interface PublishedPort {
  host: string;
  hostPort: number;
  containerPort: number;
}

export function createDockerEngine(
  opts: DockerEngineOptions = {},
): PreviewEngine {
  const runner = opts.runner ?? runDockerCommand;
  const commandTimeoutMs = opts.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const idFactory = opts.idFactory ?? (() => randomUUID());

  const run = (args: string[], runOpts: CommandOptions = {}) =>
    runner(args, {
      timeoutMs:
        runOpts.timeoutMs === undefined ? commandTimeoutMs : runOpts.timeoutMs,
      env: runOpts.env,
    });

  return {
    kind: "docker",

    async available(): Promise<boolean> {
      try {
        const result = await runner(["version"], {
          timeoutMs: Math.min(commandTimeoutMs, 5_000),
        });
        if (result.code === 0 && !result.timedOut) {
          return true;
        }

        const info = await runner(["info"], {
          timeoutMs: Math.min(commandTimeoutMs, 5_000),
        });
        return info.code === 0 && !info.timedOut;
      } catch {
        return false;
      }
    },

    async boot(spec: PreviewSpec): Promise<PreviewHandle> {
      const previewId = safeDockerName(idFactory());
      const name = `${DOCKER_NAME_PREFIX}${previewId}`;
      const hostPort = await allocateLoopbackPort();

      if (spec.composeFile !== undefined || spec.engine === "compose") {
        return bootCompose({
          spec,
          name,
          hostPort,
          run,
          readyTimeoutMs,
        });
      }

      return bootImage({
        spec,
        name,
        hostPort,
        pull: opts.pull === true,
        run,
        readyTimeoutMs,
      });
    },

    async sweep(): Promise<void> {
      await sweepDockerPreviews(run);
    },
  };
}

export async function runDockerCommand(
  args: string[],
  opts: CommandOptions = {},
): Promise<CommandResult> {
  const timeoutMs =
    opts.timeoutMs === undefined ? DEFAULT_COMMAND_TIMEOUT_MS : opts.timeoutMs;
  const env = opts.env === undefined ? undefined : mergeEnv(opts.env);
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  let timedOut = false;
  const timeout =
    timeoutMs === null
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs);

  const stdoutPromise = streamToText(proc.stdout);
  const stderrPromise = streamToText(proc.stderr);

  let code: number | null = null;
  try {
    code = await proc.exited;
  } catch {
    code = null;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { code, stdout, stderr, timedOut };
}

export function imageRunArgs(
  spec: PreviewSpec,
  name: string,
  hostPort: number,
): string[] {
  if (spec.image === undefined) {
    throw new Error("Docker preview spec must declare an image");
  }

  const args = [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-p",
    `127.0.0.1:${hostPort}:${spec.port}`,
  ];

  if (spec.limits?.cpus !== undefined) {
    args.push("--cpus", spec.limits.cpus);
  }

  if (spec.limits?.memory !== undefined) {
    args.push("--memory", spec.limits.memory);
  }

  for (const [key, value] of Object.entries(spec.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(spec.image);
  return args;
}

export function composeEnv(
  spec: PreviewSpec,
  hostPort: number,
): Record<string, string> {
  return {
    ...(spec.env ?? {}),
    ASPEX_PREVIEW_HOST: "127.0.0.1",
    ASPEX_PREVIEW_HOST_PORT: String(hostPort),
    ASPEX_PREVIEW_CONTAINER_PORT: String(spec.port),
  };
}

async function bootImage(args: {
  spec: PreviewSpec;
  name: string;
  hostPort: number;
  pull: boolean;
  run: (args: string[], opts?: CommandOptions) => Promise<CommandResult>;
  readyTimeoutMs: number;
}): Promise<PreviewHandle> {
  const { spec, name, hostPort, pull, run, readyTimeoutMs } = args;
  if (spec.image === undefined) {
    throw new Error("Docker preview spec must declare an image");
  }

  if (pull) {
    await expectOk(run(["pull", spec.image]), `docker pull ${spec.image}`);
  }

  await expectOk(run(imageRunArgs(spec, name, hostPort)), `docker run ${name}`);
  const handle = createDockerHandle(async () => {
    await run(["rm", "-f", name]);
  }, `http://127.0.0.1:${hostPort}`);

  watchContainerExit(name, run, handle);

  try {
    await waitForTcpReady(hostPort, readyTimeoutMs);
  } catch (error) {
    await handle.stop();
    throw error;
  }

  return handle;
}

async function bootCompose(args: {
  spec: PreviewSpec;
  name: string;
  hostPort: number;
  run: (args: string[], opts?: CommandOptions) => Promise<CommandResult>;
  readyTimeoutMs: number;
}): Promise<PreviewHandle> {
  const { spec, name, hostPort, run, readyTimeoutMs } = args;
  if (spec.composeFile === undefined) {
    throw new Error("Compose preview spec must declare a composeFile");
  }

  const env = composeEnv(spec, hostPort);
  const composeArgs = ["compose", "-f", spec.composeFile, "-p", name];
  await expectOk(
    run([...composeArgs, "up", "-d"], { env }),
    `docker compose up ${name}`,
  );

  const published = await findPublishedLoopbackPort(run, name, spec.port);
  const readyPort = published?.hostPort ?? hostPort;
  if (published === undefined || published.host !== "127.0.0.1") {
    await run([...composeArgs, "down"], { env });
    throw new Error(
      "Compose preview must publish the declared port on 127.0.0.1. " +
        "Use ASPEX_PREVIEW_HOST_PORT/ASPEX_PREVIEW_CONTAINER_PORT in the compose file.",
    );
  }

  const handle = createDockerHandle(async () => {
    await run([...composeArgs, "down"], { env });
  }, `http://127.0.0.1:${readyPort}`);

  watchComposeExit(name, run, handle);

  try {
    await waitForTcpReady(readyPort, readyTimeoutMs);
  } catch (error) {
    await handle.stop();
    throw error;
  }

  return handle;
}

function createDockerHandle(
  stopDocker: () => Promise<void>,
  url: string,
): DockerPreviewHandle {
  const callbacks = new Set<(info: ExitInfo) => void>();
  let stopped = false;
  let fired = false;

  return {
    url,

    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      callbacks.clear();
      await stopDocker();
    },

    onExit(cb: (info: ExitInfo) => void): void {
      if (stopped || fired) {
        return;
      }
      callbacks.add(cb);
    },

    fireExit(info: ExitInfo): void {
      if (stopped || fired) {
        return;
      }
      fired = true;
      const registered = [...callbacks];
      callbacks.clear();
      for (const cb of registered) {
        cb(info);
      }
    },

    isStopped(): boolean {
      return stopped;
    },
  };
}

function watchContainerExit(
  name: string,
  run: (args: string[], opts?: CommandOptions) => Promise<CommandResult>,
  handle: DockerPreviewHandle,
): void {
  void (async () => {
    const result = await run(["wait", name], { timeoutMs: null });
    if (handle.isStopped()) {
      return;
    }

    const code = Number.parseInt(result.stdout.trim(), 10);
    handle.fireExit({
      code: Number.isNaN(code) ? null : code,
      message:
        result.code === 0
          ? `Docker preview ${name} exited`
          : cleanMessage(result.stderr) || `Docker preview ${name} exited`,
    });
  })();
}

function watchComposeExit(
  project: string,
  run: (args: string[], opts?: CommandOptions) => Promise<CommandResult>,
  handle: DockerPreviewHandle,
): void {
  void (async () => {
    while (!handle.isStopped()) {
      const result = await run([
        "ps",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]);
      if (result.code === 0 && result.stdout.trim().length === 0) {
        handle.fireExit({
          code: null,
          message: `Docker compose preview ${project} exited`,
        });
        return;
      }
      await sleep(1_000);
    }
  })();
}

async function sweepDockerPreviews(
  run: (args: string[], opts?: CommandOptions) => Promise<CommandResult>,
): Promise<void> {
  const containers = await run(["ps", "-a", "--format", "{{.ID}} {{.Names}}"]);
  const ids = idsWithPrefixedNames(containers.stdout);
  if (ids.length > 0) {
    await run(["rm", "-f", ...ids]);
  }

  const networks = await run([
    "network",
    "ls",
    "--format",
    "{{.ID}} {{.Name}}",
  ]);
  const networkIds = idsWithPrefixedNames(networks.stdout);
  for (const networkId of networkIds) {
    await run(["network", "rm", networkId]);
  }
}

function idsWithPrefixedNames(stdout: string): string[] {
  const ids: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const [id, names] = trimmed.split(/\s+/, 2);
    if (id === undefined || names === undefined) {
      continue;
    }

    const hasAspexPreviewName = names
      .split(",")
      .some((name) => name.startsWith(DOCKER_NAME_PREFIX));
    if (hasAspexPreviewName) {
      ids.push(id);
    }
  }
  return ids;
}

async function findPublishedLoopbackPort(
  run: (args: string[], opts?: CommandOptions) => Promise<CommandResult>,
  project: string,
  containerPort: number,
): Promise<PublishedPort | undefined> {
  const result = await run([
    "ps",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    "{{json .}}",
  ]);
  if (result.code !== 0) {
    return undefined;
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = parseDockerPsJson(line);
    if (parsed === undefined) {
      continue;
    }
    for (const port of parsePublishedPorts(parsed.Ports)) {
      if (port.containerPort === containerPort) {
        return port;
      }
    }
  }

  return undefined;
}

function parseDockerPsJson(line: string): { Ports?: string } | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "Ports" in parsed &&
      typeof parsed.Ports === "string"
    ) {
      return { Ports: parsed.Ports };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function parsePublishedPorts(raw: string | undefined): PublishedPort[] {
  if (raw === undefined) {
    return [];
  }

  const ports: PublishedPort[] = [];
  const pattern =
    /(?<host>\d+\.\d+\.\d+\.\d+):(?<hostPort>\d+)->(?<containerPort>\d+)\/tcp/g;
  for (const match of raw.matchAll(pattern)) {
    const host = match.groups?.host;
    const hostPort = Number.parseInt(match.groups?.hostPort ?? "", 10);
    const containerPort = Number.parseInt(
      match.groups?.containerPort ?? "",
      10,
    );
    if (
      host !== undefined &&
      !Number.isNaN(hostPort) &&
      !Number.isNaN(containerPort)
    ) {
      ports.push({ host, hostPort, containerPort });
    }
  }
  return ports;
}

async function expectOk(
  resultPromise: Promise<CommandResult>,
  label: string,
): Promise<CommandResult> {
  const result = await resultPromise;
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`${label} failed: ${cleanMessage(result.stderr)}`);
  }
  return result;
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("Failed to allocate preview port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForTcpReady(port: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canConnect(port)) {
      return;
    }
    await sleep(READY_POLL_MS);
  }
  throw new Error(`Docker preview did not become ready on 127.0.0.1:${port}`);
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function streamToText(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (stream === null) {
    return Promise.resolve("");
  }
  return new Response(stream).text();
}

function mergeEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

function safeDockerName(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
  return safe.length > 0 ? safe : randomUUID();
}

function cleanMessage(stderr: string): string {
  return stderr.trim().replace(/\s+/g, " ");
}
