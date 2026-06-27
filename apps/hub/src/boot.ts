import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ClaudeCodeAdapter } from "@aspex/adapter-claude-code";
import { GithubAdapter } from "@aspex/adapter-github";
import { MockAdapter } from "@aspex/adapter-mock";
import { WebhookAdapter } from "@aspex/adapter-webhook";
import { AdapterRegistry } from "./adapters/registry";
import { Bus } from "./bus";
import { type AspexConfig, resolvedLivenessConfig } from "./config";
import { enforceOwnership } from "./engine/attention";
import { LivenessTicker, livenessAt, nextStaleAfter } from "./engine/liveness";
import { buildApp } from "./http/server";
import { openDb } from "./store/db";
import { ItemStore } from "./store/itemStore";
import { WorldModel } from "./world/worldModel";

export const VERSION = "0.0.0";

export function buildHub(cfg: AspexConfig) {
  ensureDbDirectory(cfg.dbPath);

  const db = openDb(cfg.dbPath);
  const store = new ItemStore(db);
  const bus = new Bus();
  const livenessCfg = resolvedLivenessConfig(cfg);
  const world = new WorldModel(store, bus, {
    deriveAttention: enforceOwnership,
    deriveLiveness: (item) => {
      const staleAfter = nextStaleAfter(
        item.source,
        item.state,
        item.observedAt,
        livenessCfg,
      );
      const withStaleAfter = { ...item, staleAfter };

      return {
        ...withStaleAfter,
        liveness: livenessAt(withStaleAfter, Date.now(), livenessCfg),
      };
    },
  });
  const liveness = new LivenessTicker(
    () => store.getAll(),
    (item) => world.updateItem(item),
    livenessCfg,
  );

  const registry = new AdapterRegistry(world, liveness);

  registry.register(new ClaudeCodeAdapter());
  registry.register(new WebhookAdapter());

  if (cfg.mock === true) {
    registry.register(new MockAdapter());
  }

  if (cfg.github !== undefined) {
    registry.register(
      new GithubAdapter({
        token: cfg.github.token,
        allowlist: cfg.github.allowlist,
        pollIntervalMs: cfg.pollIntervalMs,
      }),
    );
  }

  const app = buildApp({
    worldModel: world,
    bus,
    cap: cfg.needsMeCap,
    version: VERSION,
    dispatchAction: registry.dispatchAction.bind(registry),
    actionMeta: registry.actionMeta.bind(registry),
  });

  return {
    app,
    bus,
    registry,
    world,
    start: async () => {
      await registry.startAll();
      liveness.start();
    },
    stop: async () => {
      liveness.stop();
      await registry.stopAll();
      db.close();
    },
  };
}

function ensureDbDirectory(dbPath: string): void {
  if (dbPath === ":memory:") {
    return;
  }

  mkdirSync(dirname(dbPath), { recursive: true });
}
