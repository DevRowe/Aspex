import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ClaudeCodeAdapter } from "@aspex/adapter-claude-code";
import { CodexAdapter } from "@aspex/adapter-codex";
import { CursorAdapter } from "@aspex/adapter-cursor";
import { GithubAdapter } from "@aspex/adapter-github";
import { MockAdapter } from "@aspex/adapter-mock";
import { NtfyNotifier } from "@aspex/adapter-ntfy";
import { OpenCodeAdapter } from "@aspex/adapter-opencode";
import { WebhookAdapter } from "@aspex/adapter-webhook";
import { AdapterRegistry } from "./adapters/registry";
import { Bus } from "./bus";
import { type AspexConfig, resolvedLivenessConfig } from "./config";
import { enforceOwnership, rank } from "./engine/attention";
import { LivenessTicker, livenessAt, nextStaleAfter } from "./engine/liveness";
import { type ServerDeps, buildApp } from "./http/server";
import { createPreviewBroker } from "./preview/broker";
import type { PreviewEngine } from "./preview/engine";
import { createDockerEngine } from "./preview/engineDocker";
import { createMockEngine } from "./preview/engineMock";
import { type PreviewRegistry, loadPreviewRegistry } from "./preview/registry";
import { openDb } from "./store/db";
import { ItemStore } from "./store/itemStore";
import { VoiceGateway } from "./voice/gateway";
import { MockIntentService, OllamaIntentService } from "./voice/intentService";
import { HttpSttClient, MockSttClient } from "./voice/sttClient";
import { HttpTtsClient, MockTtsClient } from "./voice/ttsClient";
import { WorldModel } from "./world/worldModel";

export const VERSION = "0.0.0";

// How often the Hub reaps idle-expired previews. The broker also sweeps lazily on
// boot/get/list; this ticker guarantees an otherwise-idle Hub still auto-reaps.
const PREVIEW_SWEEP_INTERVAL_MS = 15_000;

export interface BuildHubOptions {
  previewEngineFactory?: (kind: "docker" | "mock") => PreviewEngine;
  log?: Pick<Console, "warn">;
}

export function buildHub(cfg: AspexConfig, options: BuildHubOptions = {}) {
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

  if (cfg.adapters?.codex?.enabled === true) {
    registry.register(new CodexAdapter());
  }

  if (cfg.adapters?.opencode?.enabled === true) {
    registry.register(new OpenCodeAdapter(cfg.adapters.opencode));
  }

  if (cfg.adapters?.cursor?.enabled === true) {
    registry.register(new CursorAdapter());
  }

  if (cfg.ntfy !== undefined) {
    new NtfyNotifier(cfg.ntfy, bus);
  }

  const intentService =
    cfg.intent?.enabled === true
      ? cfg.intent.mock === true || cfg.mock === true
        ? new MockIntentService()
        : new OllamaIntentService({
            endpoints: cfg.intent.endpoints,
            model: cfg.intent.model,
            timeoutMs: cfg.intent.timeoutMs,
          })
      : undefined;
  const voiceGateway =
    cfg.voice?.enabled === true || cfg.intent?.enabled === true
      ? new VoiceGateway({
          stt:
            cfg.voice?.enabled !== true || cfg.voice.mock === true
              ? new MockSttClient()
              : new HttpSttClient(cfg.voice.stt),
          tts:
            cfg.voice?.enabled !== true
              ? null
              : cfg.voice.mock === true
                ? new MockTtsClient()
                : cfg.voice.tts.endpoint !== undefined
                  ? new HttpTtsClient({
                      endpoint: cfg.voice.tts.endpoint,
                      timeoutMs: cfg.voice.stt.timeoutMs,
                    })
                  : null,
          dispatchAction: registry.dispatchAction.bind(registry),
          getSelectedActions: (id) =>
            world.snapshot().find((item) => item.id === id)?.actions ?? [],
          resolveProject: (name) =>
            resolveProjectId(world, name, cfg.needsMeCap),
          snapshotNeedsMe: () =>
            rank(world.snapshot(), cfg.needsMeCap).needsMe.map(
              (item) => item.id,
            ),
          snapshotCandidates: () =>
            rank(world.snapshot(), cfg.needsMeCap).needsMe.map((item) => ({
              itemId: item.id,
              summary: item.summary,
              actions: item.actions.map((action) => action.id),
            })),
          readItem: (id) => readItem(world, id),
          intentService,
          elevateFreeformConfirm: cfg.intent?.elevateConfirm ?? true,
          confidenceThreshold: cfg.voice?.confidenceThreshold ?? 0.6,
          confirmTtlMs: cfg.voice?.confirmTtlMs ?? 8000,
        })
      : undefined;

  const appDeps: Omit<ServerDeps, "previews"> = {
    worldModel: world,
    bus,
    cap: cfg.needsMeCap,
    version: VERSION,
    dispatchAction: registry.dispatchAction.bind(registry),
    actionMeta: registry.actionMeta.bind(registry),
    voiceGateway,
    voice: {
      enabled: cfg.voice?.enabled === true,
      pttKey: cfg.voice?.pttKey ?? "Space",
      stt: cfg.voice?.mock === true ? "mock" : "http",
      tts:
        cfg.voice?.enabled === true && cfg.voice.mock === true
          ? true
          : cfg.voice?.tts.endpoint !== undefined,
    },
    intent: {
      enabled: cfg.intent?.enabled === true,
      mock: cfg.intent?.mock === true || cfg.mock === true,
    },
    ...(cfg.adapters?.cursor?.enabled === true
      ? {
          cursorWebhook: {
            enabled: true,
            secret: cfg.adapters.cursor.secret,
          },
        }
      : {}),
  };
  let app = buildApp({
    ...appDeps,
    previews: { enabled: false },
  });
  let previewBroker: ReturnType<typeof createPreviewBroker> | undefined;
  let previewSweep: ReturnType<typeof setInterval> | undefined;
  const log = options.log ?? console;

  return {
    get app() {
      return app;
    },
    bus,
    registry,
    world,
    start: async () => {
      const previewDeps = await preparePreviews(cfg, {
        engineFactory: options.previewEngineFactory ?? createPreviewEngine,
        log,
      });
      previewBroker = previewDeps?.broker;
      if (previewBroker !== undefined) {
        const broker = previewBroker;
        previewSweep = setInterval(() => {
          void broker.sweep();
        }, PREVIEW_SWEEP_INTERVAL_MS);
        previewSweep.unref?.();
      }
      app = buildApp({
        ...appDeps,
        previews:
          previewDeps === undefined
            ? { enabled: false }
            : {
                enabled: true,
                broker: previewDeps.broker,
                registry: previewDeps.registry,
              },
      });
      await registry.startAll();
      liveness.start();
    },
    stop: async () => {
      if (previewSweep !== undefined) {
        clearInterval(previewSweep);
        previewSweep = undefined;
      }
      liveness.stop();
      await registry.stopAll();
      await previewBroker?.shutdown();
      db.close();
    },
  };
}

async function preparePreviews(
  cfg: AspexConfig,
  options: {
    engineFactory: (kind: "docker" | "mock") => PreviewEngine;
    log: Pick<Console, "warn">;
  },
): Promise<
  | {
      broker: ReturnType<typeof createPreviewBroker>;
      registry: PreviewRegistry;
    }
  | undefined
> {
  const previews = cfg.previews;

  if (previews?.enabled !== true) {
    return undefined;
  }

  const { registry, errors } = loadPreviewRegistry(previews.specs);
  for (const error of errors) {
    options.log.warn(
      `Skipping invalid Preview spec at index ${error.index}${
        error.specId === undefined ? "" : ` (${error.specId})`
      }: ${error.message}`,
    );
  }

  const engine = options.engineFactory(previews.engine);
  const available = await engine.available();

  if (!available) {
    options.log.warn(
      `previews enabled but ${previews.engine} engine unavailable; Preview Deck routes disabled`,
    );
    return undefined;
  }

  await engine.sweep?.();

  return {
    registry,
    broker: createPreviewBroker({
      engine,
      lookupSpec: registry.get,
      config: {
        maxConcurrent: previews.maxConcurrent,
        defaultIdleTtlSec: previews.limits.idleTtlSec,
      },
    }),
  };
}

function createPreviewEngine(kind: "docker" | "mock"): PreviewEngine {
  return kind === "mock" ? createMockEngine() : createDockerEngine();
}

function resolveProjectId(
  world: WorldModel,
  name: string,
  needsMeCap: number,
): string | "ambiguous" | null {
  const normalized = name.trim().toLowerCase();

  if (normalized === "") {
    return null;
  }

  const snapshot = world.snapshot();
  const matches = snapshot.filter(
    (item) => item.project.trim().toLowerCase() === normalized,
  );

  if (matches.length === 0) {
    return null;
  }

  const topNeedsMeMatch = rank(snapshot, needsMeCap).needsMe.find(
    (item) => item.project.trim().toLowerCase() === normalized,
  );

  if (topNeedsMeMatch !== undefined) {
    return topNeedsMeMatch.id;
  }

  const sorted = matches.toSorted(
    (left, right) =>
      Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
      left.id.localeCompare(right.id),
  );

  return sorted[0]?.id ?? null;
}

function readItem(world: WorldModel, id: string): string {
  const item = world.snapshot().find((candidate) => candidate.id === id);

  if (item === undefined) {
    return "Nothing selected.";
  }

  const actions =
    item.actions.length === 0
      ? "No actions available."
      : `Actions: ${item.actions.map((action) => action.label).join(", ")}.`;

  return `${item.project}: ${item.summary} ${actions}`;
}

function ensureDbDirectory(dbPath: string): void {
  if (dbPath === ":memory:") {
    return;
  }

  mkdirSync(dirname(dbPath), { recursive: true });
}
