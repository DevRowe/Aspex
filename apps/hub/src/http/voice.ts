import { type VoiceContext, assertVoiceContext } from "@aspex/schema";
import type { Hono } from "hono";
import type { ServerDeps } from "./server";

const AUDIO_TTL_MS = 60_000;

interface CachedAudio {
  bytes: Uint8Array;
  expiresAt: number;
}

export function registerVoiceRoutes(app: Hono, deps: ServerDeps): void {
  const audioCache = new Map<string, CachedAudio>();

  app.post("/voice/utterance", async (c) => {
    if (deps.voiceGateway === undefined) {
      return c.json({ error: "voice not configured" }, 503);
    }

    let request: {
      bytes: Uint8Array;
      mime: string;
      context: VoiceContext;
    };

    try {
      cleanupAudioCache(audioCache, Date.now());
      const form = await c.req.formData();
      const audio = form.get("audio");
      const context = readVoiceContext(form.get("context"));

      if (!isFileLike(audio)) {
        return c.json({ message: "Missing audio" }, 400);
      }

      request = {
        bytes: new Uint8Array(await audio.arrayBuffer()),
        mime: audio.type,
        context,
      };
    } catch (error) {
      return c.json({ message: validationMessage(error) }, 400);
    }

    const result = await deps.voiceGateway.handle(
      request.bytes,
      request.mime,
      request.context,
    );
    const rawAudio = result.audio;
    const jsonResult = {
      ok: result.ok,
      readback: result.readback,
      ...(result.directive !== undefined
        ? { directive: result.directive }
        : {}),
      session: result.session,
    };

    if (rawAudio !== undefined) {
      const id = crypto.randomUUID();
      audioCache.set(id, {
        bytes: rawAudio,
        expiresAt: Date.now() + AUDIO_TTL_MS,
      });
      return c.json({ ...jsonResult, audioUrl: `/voice/audio/${id}` });
    }

    return c.json(jsonResult);
  });

  app.get("/voice/audio/:id", (c) => {
    const now = Date.now();
    cleanupAudioCache(audioCache, now);
    const cached = audioCache.get(c.req.param("id"));

    if (cached === undefined || cached.expiresAt <= now) {
      return c.json({ message: "Audio not found" }, 404);
    }

    const body = cached.bytes.buffer.slice(
      cached.bytes.byteOffset,
      cached.bytes.byteOffset + cached.bytes.byteLength,
    ) as ArrayBuffer;

    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/wav",
      },
    });
  });

  app.get("/voice/health", (c) =>
    c.json({
      ok: deps.voiceGateway !== undefined,
      stt: deps.voice?.stt ?? "http",
      tts: deps.voice?.tts ?? false,
    }),
  );

  app.get("/voice/config", (c) =>
    c.json({
      enabled: deps.voice?.enabled ?? false,
      pttKey: deps.voice?.pttKey ?? "Space",
    }),
  );
}

function readVoiceContext(value: FormDataEntryValue | null): VoiceContext {
  if (typeof value !== "string") {
    throw new Error("Missing context");
  }

  const context = JSON.parse(value);
  assertVoiceContext(context);
  return context;
}

function cleanupAudioCache(
  audioCache: Map<string, CachedAudio>,
  now: number,
): void {
  for (const [id, cached] of audioCache) {
    if (cached.expiresAt <= now) {
      audioCache.delete(id);
    }
  }
}

function validationMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid request";
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "type" in value &&
    typeof value.type === "string"
  );
}
