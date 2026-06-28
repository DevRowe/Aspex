import { describe, expect, mock, test } from "bun:test";
import type { PreviewSpec } from "@aspex/schema";
import { createMockEngine } from "../../src/preview/engineMock";

const spec: PreviewSpec = {
  id: "mock-preview",
  name: "Mock Preview",
  engine: "mock",
  image: "aspex/mock-preview:latest",
  port: 3000,
  trust: "trusted",
};

describe("createMockEngine", () => {
  test("is always available", async () => {
    const engine = createMockEngine();

    await expect(engine.available()).resolves.toBe(true);
  });

  test("boots a handle with the default loopback URL", async () => {
    const engine = createMockEngine();

    const handle = await engine.boot(spec);

    expect(handle.url).toBe("http://127.0.0.1:41999");
  });

  test("uses an injected port", async () => {
    const engine = createMockEngine({ port: 42010 });

    const handle = await engine.boot(spec);

    expect(handle.url).toBe("http://127.0.0.1:42010");
  });

  test("can fail boot with a clear error", async () => {
    const engine = createMockEngine({ failBoot: true });

    await expect(engine.boot(spec)).rejects.toThrow(
      "Mock preview engine failed to boot",
    );
  });

  test("stop is idempotent", async () => {
    const engine = createMockEngine();
    const handle = await engine.boot(spec);

    await expect(handle.stop()).resolves.toBeUndefined();
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  test("simulateExit invokes registered onExit callbacks exactly once", async () => {
    const engine = createMockEngine();
    const handle = await engine.boot(spec);
    const onExit = mock();

    handle.onExit(onExit);
    handle.onExit(onExit);
    engine.simulateExit("preview crashed");
    engine.simulateExit("preview crashed again");

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({
      code: null,
      message: "preview crashed",
    });
  });

  test("simulateExit does not fire callbacks for a stopped handle", async () => {
    const engine = createMockEngine();
    const handle = await engine.boot(spec);
    const onExit = mock();

    handle.onExit(onExit);
    await handle.stop();
    engine.simulateExit("preview crashed");

    expect(onExit).not.toHaveBeenCalled();
  });

  test("a new boot can still simulate exit after a previous handle exited", async () => {
    const engine = createMockEngine();
    const first = await engine.boot(spec);
    const firstExit = mock();

    first.onExit(firstExit);
    engine.simulateExit("first preview crashed");

    const second = await engine.boot(spec);
    const secondExit = mock();
    second.onExit(secondExit);
    engine.simulateExit("second preview crashed");

    expect(firstExit).toHaveBeenCalledTimes(1);
    expect(firstExit).toHaveBeenCalledWith({
      code: null,
      message: "first preview crashed",
    });
    expect(secondExit).toHaveBeenCalledTimes(1);
    expect(secondExit).toHaveBeenCalledWith({
      code: null,
      message: "second preview crashed",
    });
  });
});
