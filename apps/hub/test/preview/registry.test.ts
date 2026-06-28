import { describe, expect, test } from "bun:test";
import type { PreviewSpec } from "@aspex/schema";
import { loadPreviewRegistry } from "../../src/preview/registry";

const baseSpec: PreviewSpec = {
  id: "web",
  name: "Web",
  engine: "docker",
  image: "nginx:alpine",
  port: 80,
  trust: "trusted",
  limits: {},
};

describe("loadPreviewRegistry", () => {
  test("loads valid specs in config order", () => {
    const api = spec({ id: "api", name: "API", itemId: "github:pr:one#1" });
    const web = spec({ id: "web", name: "Web", itemId: "github:pr:two#2" });

    const { registry, errors } = loadPreviewRegistry([api, web]);

    expect(errors).toEqual([]);
    expect(registry.list()).toEqual([api, web]);
  });

  test("skips invalid specs and reports the index", () => {
    const valid = spec({ id: "valid" });

    const { registry, errors } = loadPreviewRegistry([
      valid,
      { ...baseSpec, id: "invalid", port: 0 },
    ]);

    expect(registry.list()).toEqual([valid]);
    expect(errors).toEqual([{ index: 1, message: "Invalid PreviewSpec" }]);
  });

  test("keeps the first duplicate id and reports later duplicates", () => {
    const first = spec({ id: "same", name: "First" });
    const duplicate = spec({ id: "same", name: "Second" });

    const { registry, errors } = loadPreviewRegistry([first, duplicate]);

    expect(registry.list()).toEqual([first]);
    expect(registry.get("same")).toEqual(first);
    expect(errors).toEqual([
      {
        index: 1,
        specId: "same",
        message: "Duplicate PreviewSpec id: same",
      },
    ]);
  });

  test("get and byItem return exact id matches", () => {
    const first = spec({ id: "first", itemId: "github:pr:owner/repo#1" });
    const second = spec({ id: "second", itemId: "github:pr:owner/repo#1" });
    const other = spec({ id: "other", itemId: "github:pr:owner/repo#10" });

    const { registry } = loadPreviewRegistry([first, second, other]);

    expect(registry.get("first")).toEqual(first);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.byItem("github:pr:owner/repo#1")).toEqual([first, second]);
    expect(registry.byItem("github:pr:owner/repo#10")).toEqual([other]);
    expect(registry.byItem("github:pr:owner/repo#2")).toEqual([]);
  });

  test("stores trusted and untrusted specs alike", () => {
    const trusted = spec({ id: "trusted", trust: "trusted" });
    const untrusted = spec({ id: "untrusted", trust: "untrusted" });

    const { registry, errors } = loadPreviewRegistry([trusted, untrusted]);

    expect(errors).toEqual([]);
    expect(registry.list()).toEqual([trusted, untrusted]);
  });

  test("returned arrays do not mutate registry state", () => {
    const first = spec({ id: "first", itemId: "github:pr:owner/repo#1" });
    const second = spec({ id: "second", itemId: "github:pr:owner/repo#1" });
    const { registry } = loadPreviewRegistry([first, second]);

    registry.list().pop();
    registry.byItem("github:pr:owner/repo#1").pop();

    expect(registry.list()).toEqual([first, second]);
    expect(registry.byItem("github:pr:owner/repo#1")).toEqual([first, second]);
  });

  test("freezes accepted specs after load", () => {
    const raw = spec({
      id: "frozen",
      env: { NODE_ENV: "production" },
      limits: { cpus: "0.5" },
    });
    const { registry } = loadPreviewRegistry([raw]);
    const rawEnv = raw.env;
    const rawLimits = raw.limits;

    if (rawEnv === undefined || rawLimits === undefined) {
      throw new Error("test fixture must include env and limits");
    }

    raw.name = "Changed";
    rawEnv.NODE_ENV = "development";
    rawLimits.cpus = "1";

    expect(registry.get("frozen")).toEqual(
      spec({
        id: "frozen",
        env: { NODE_ENV: "production" },
        limits: { cpus: "0.5" },
      }),
    );
    const loaded = registry.get("frozen");

    if (loaded === undefined) {
      throw new Error("expected frozen spec to load");
    }

    expect(() => {
      loaded.name = "Mutated";
    }).toThrow();
  });

  test("empty input returns an empty registry and no errors", () => {
    const { registry, errors } = loadPreviewRegistry([]);

    expect(errors).toEqual([]);
    expect(registry.list()).toEqual([]);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.byItem("github:pr:owner/repo#1")).toEqual([]);
  });
});

function spec(overrides: Partial<PreviewSpec> = {}): PreviewSpec {
  return {
    ...baseSpec,
    ...overrides,
  };
}
