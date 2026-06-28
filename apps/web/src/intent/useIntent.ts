import type { VoiceContext, VoiceResult } from "@aspex/schema";
import { useCallback, useEffect, useState } from "react";
import {
  type HubClientConfig,
  getHubConfig,
  getHubUrl,
} from "../lib/hubClient";
import { useStore } from "../store";
import { applyDirective } from "../voice/applyDirective";
import { useVoiceStore } from "../voice/voiceStore";

export interface IntentRequestBody {
  text: string;
  context: VoiceContext;
}

export interface IntentSubmitState {
  submitting: boolean;
  error: string | null;
  submitIntent: (text: string) => Promise<VoiceResult | null>;
}

export async function postIntent(
  text: string,
  context: VoiceContext,
): Promise<VoiceResult> {
  const hub = await getHubUrl();
  const response = await fetch(`${hub}/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, context } satisfies IntentRequestBody),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Intent failed (${response.status} ${response.statusText})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  return (await response.json()) as VoiceResult;
}

export function buildIntentContext(): VoiceContext {
  const { selectedId, needsMe } = useStore.getState();
  return {
    ...(selectedId ? { selectedId } : {}),
    needsMeIds: needsMe.map((item) => item.id),
  };
}

export function applyIntentResult(result: VoiceResult): void {
  useVoiceStore.getState().applyResult(result);
  applyDirective(result.directive);
}

export function isIntentEnabled(
  config: HubClientConfig | null | undefined,
): boolean {
  return config?.intentEnabled !== false && config?.intent?.enabled !== false;
}

export function useIntentAvailability(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let disposed = false;

    void getHubConfig()
      .then((config) => {
        if (!disposed) {
          setEnabled(isIntentEnabled(config));
        }
      })
      .catch(() => {
        if (!disposed) {
          setEnabled(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  return enabled;
}

export function useIntent(): IntentSubmitState {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitIntent = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") {
      return null;
    }

    setSubmitting(true);
    setError(null);
    useVoiceStore.getState().setPhase("transcribing");

    try {
      const result = await postIntent(trimmed, buildIntentContext());
      applyIntentResult(result);
      return result;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Intent request failed.";
      setError(message);
      useVoiceStore.getState().setError(message);
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submitting, error, submitIntent };
}
