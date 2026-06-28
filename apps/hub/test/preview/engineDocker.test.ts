import { describe, expect, mock, test } from "bun:test";
import { type Server, createServer } from "node:net";
import type { PreviewSpec } from "@aspex/schema";
import {
  composeEnv,
  createDockerEngine,
  imageRunArgs,
  parsePublishedPorts,
} from "../../src/preview/engineDocker";

const ok = (stdout = "") => ({
  code: 0,
  stdout,
  stderr: "",
  timedOut: false,
});

const imageSpec: PreviewSpec = {
  id: "web",
  name: "Web",
  engine: "docker",
  image: "nginx:alpine",
  port: 80,
  trust: "trusted",
  env: { NODE_ENV: "production" },
  limits: { cpus: "0.5", memory: "256m" },
};

const composeSpec: PreviewSpec = {
  id: "compose-web",
  name: "Compose Web",
  engine: "compose",
  composeFile: "compose.preview.yml",
  port: 3000,
  trust: "trusted",
  env: { APP_ENV: "preview" },
};

describe("createDockerEngine", () => {
  test("available returns false when the docker probe throws", async () => {
    const engine = createDockerEngine({
      runner: async () => {
        throw new Error("docker missing");
      },
    });

    await expect(engine.available()).resolves.toBe(false);
  });

  test("available falls back from docker version to docker info", async () => {
    const calls: string[][] = [];
    const engine = createDockerEngine({
      runner: async (args) => {
        calls.push(args);
        return {
          code: args[0] === "info" ? 0 : 1,
          stdout: "",
          stderr: "",
          timedOut: false,
        };
      },
    });

    await expect(engine.available()).resolves.toBe(true);
    expect(calls).toEqual([["version"], ["info"]]);
  });

  test("available returns false when probes time out", async () => {
    const engine = createDockerEngine({
      runner: async () => ({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: true,
      }),
    });

    await expect(engine.available()).resolves.toBe(false);
  });

  test("image boot watches docker wait without the command timeout", async () => {
    let previewServer: Server | undefined;
    let waitOptions: { timeoutMs?: number | null } | undefined;
    let resolveWait: (result: ReturnType<typeof ok>) => void = () => {};
    const waitPromise = new Promise<ReturnType<typeof ok>>((resolve) => {
      resolveWait = resolve;
    });

    const engine = createDockerEngine({
      idFactory: () => "wait-test",
      runner: async (args, opts) => {
        if (args[0] === "run") {
          const hostPort = hostPortFromRunArgs(args);
          previewServer = await listenOnLoopback(hostPort);
          return ok("container-id");
        }
        if (args[0] === "wait") {
          waitOptions = opts;
          return waitPromise;
        }
        if (args[0] === "rm") {
          return ok();
        }
        return ok();
      },
    });

    const handle = await engine.boot(imageSpec);
    const onExit = mock();
    handle.onExit(onExit);

    expect(waitOptions?.timeoutMs).toBeNull();

    resolveWait(ok("137"));
    await sleep(0);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({
      code: 137,
      message: "Docker preview aspex-preview-wait-test exited",
    });

    await handle.stop();
    await closeServer(previewServer);
  });

  test("stop suppresses a later docker wait exit", async () => {
    let previewServer: Server | undefined;
    let resolveWait: (result: ReturnType<typeof ok>) => void = () => {};
    const waitPromise = new Promise<ReturnType<typeof ok>>((resolve) => {
      resolveWait = resolve;
    });

    const engine = createDockerEngine({
      idFactory: () => "stop-test",
      runner: async (args) => {
        if (args[0] === "run") {
          const hostPort = hostPortFromRunArgs(args);
          previewServer = await listenOnLoopback(hostPort);
          return ok("container-id");
        }
        if (args[0] === "wait") {
          return waitPromise;
        }
        if (args[0] === "rm") {
          return ok();
        }
        return ok();
      },
    });

    const handle = await engine.boot(imageSpec);
    const onExit = mock();
    handle.onExit(onExit);

    await handle.stop();
    resolveWait(ok("0"));
    await sleep(0);

    expect(onExit).not.toHaveBeenCalled();
    await closeServer(previewServer);
  });

  test("sweep removes only names with the aspex preview prefix", async () => {
    const calls: string[][] = [];
    const engine = createDockerEngine({
      runner: async (args) => {
        calls.push(args);
        if (args[0] === "ps") {
          return ok(
            [
              "container-good aspex-preview-good",
              "container-bad my-aspex-preview-bad",
            ].join("\n"),
          );
        }
        if (args[0] === "network") {
          if (args[1] === "ls") {
            return ok(
              [
                "network-good aspex-preview-good_default",
                "network-bad my-aspex-preview-bad_default",
              ].join("\n"),
            );
          }
          return ok();
        }
        return ok();
      },
    });

    await expect(engine.sweep?.()).resolves.toBeUndefined();

    expect(calls).toContainEqual(["rm", "-f", "container-good"]);
    expect(calls).toContainEqual(["network", "rm", "network-good"]);
    expect(calls).not.toContainEqual(["rm", "-f", "container-bad"]);
    expect(calls).not.toContainEqual(["network", "rm", "network-bad"]);
  });
});

describe("imageRunArgs", () => {
  test("builds a loopback-only docker run command", () => {
    expect(imageRunArgs(imageSpec, "aspex-preview-test", 49152)).toEqual([
      "run",
      "-d",
      "--rm",
      "--name",
      "aspex-preview-test",
      "-p",
      "127.0.0.1:49152:80",
      "--cpus",
      "0.5",
      "--memory",
      "256m",
      "-e",
      "NODE_ENV=production",
      "nginx:alpine",
    ]);
  });
});

describe("composeEnv", () => {
  test("passes loopback port variables for declared compose files", () => {
    expect(composeEnv(composeSpec, 49153)).toEqual({
      APP_ENV: "preview",
      ASPEX_PREVIEW_HOST: "127.0.0.1",
      ASPEX_PREVIEW_HOST_PORT: "49153",
      ASPEX_PREVIEW_CONTAINER_PORT: "3000",
    });
  });
});

describe("parsePublishedPorts", () => {
  test("extracts loopback docker ps port mappings", () => {
    expect(
      parsePublishedPorts(
        "127.0.0.1:49154->3000/tcp, 127.0.0.1:49155->9229/tcp",
      ),
    ).toEqual([
      { host: "127.0.0.1", hostPort: 49154, containerPort: 3000 },
      { host: "127.0.0.1", hostPort: 49155, containerPort: 9229 },
    ]);
  });

  test("does not invent a host mapping for unbound container ports", () => {
    expect(parsePublishedPorts("3000/tcp")).toEqual([]);
  });
});

function hostPortFromRunArgs(args: string[]): number {
  const mapping = args[args.indexOf("-p") + 1];
  if (mapping === undefined) {
    throw new Error("missing docker port mapping");
  }
  return Number.parseInt(mapping.split(":")[1] ?? "", 10);
}

function listenOnLoopback(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      socket.end("ok");
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
