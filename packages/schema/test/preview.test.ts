import { describe, expect, test } from "bun:test";
import { isPreviewSpec, parsePreviewSpec } from "../src";

describe("preview schema", () => {
  test("parses a valid image-backed spec and defaults limits", () => {
    expect(
      parsePreviewSpec({
        id: "atlas-web",
        name: "Atlas Web",
        engine: "docker",
        image: "ghcr.io/example/atlas-web:latest",
        port: 3000,
        trust: "trusted",
      }),
    ).toEqual({
      id: "atlas-web",
      name: "Atlas Web",
      engine: "docker",
      image: "ghcr.io/example/atlas-web:latest",
      port: 3000,
      trust: "trusted",
      limits: {},
    });
  });

  test("parses optional itemId, env, and limits", () => {
    expect(
      parsePreviewSpec({
        id: "atlas-compose",
        name: "Atlas Compose",
        engine: "compose",
        composeFile: "D:/projects/atlas/compose.preview.yml",
        port: 8080,
        trust: "untrusted",
        itemId: "github:pr:bro/atlas#42",
        env: { NODE_ENV: "production" },
        limits: { cpus: "1.5", memory: "512m", idleTtlSec: 900 },
      }),
    ).toEqual({
      id: "atlas-compose",
      name: "Atlas Compose",
      engine: "compose",
      composeFile: "D:/projects/atlas/compose.preview.yml",
      port: 8080,
      trust: "untrusted",
      itemId: "github:pr:bro/atlas#42",
      env: { NODE_ENV: "production" },
      limits: { cpus: "1.5", memory: "512m", idleTtlSec: 900 },
    });
  });

  test("rejects specs with both image and composeFile", () => {
    expect(() =>
      parsePreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "docker",
        image: "example/app:latest",
        composeFile: "compose.yml",
        port: 3000,
        trust: "trusted",
      }),
    ).toThrow("Invalid PreviewSpec");
  });

  test("rejects specs with neither image nor composeFile", () => {
    expect(() =>
      parsePreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "mock",
        port: 3000,
        trust: "trusted",
      }),
    ).toThrow("Invalid PreviewSpec");
  });

  test("rejects bad trust and engine values", () => {
    expect(
      isPreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "podman",
        image: "example/app:latest",
        port: 3000,
        trust: "trusted",
      }),
    ).toBe(false);

    expect(
      isPreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "docker",
        image: "example/app:latest",
        port: 3000,
        trust: "sandboxed",
      }),
    ).toBe(false);
  });

  test("rejects unusable ports and empty required strings", () => {
    expect(
      isPreviewSpec({
        id: "",
        name: "Bad",
        engine: "docker",
        image: "example/app:latest",
        port: 3000,
        trust: "trusted",
      }),
    ).toBe(false);

    expect(
      isPreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "docker",
        image: "example/app:latest",
        port: 0,
        trust: "trusted",
      }),
    ).toBe(false);

    expect(
      isPreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "docker",
        image: "example/app:latest",
        port: 65536,
        trust: "trusted",
      }),
    ).toBe(false);
  });

  test("rejects invalid env and limits shapes", () => {
    expect(
      isPreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "docker",
        image: "example/app:latest",
        port: 3000,
        trust: "trusted",
        env: ["NODE_ENV=production"],
      }),
    ).toBe(false);

    expect(
      isPreviewSpec({
        id: "bad",
        name: "Bad",
        engine: "docker",
        image: "example/app:latest",
        port: 3000,
        trust: "trusted",
        limits: { idleTtlSec: -1 },
      }),
    ).toBe(false);
  });
});
