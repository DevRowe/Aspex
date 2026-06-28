import type { VoiceContext, VoiceResult } from "@aspex/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useCapture } from "./useCapture";
import { playReadback, postUtterance, stopReadback } from "./voiceClient";

export type PushToTalkPhase = "idle" | "listening" | "sending" | "error";

interface PushToTalkOptions {
  holdKey?: string;
  enabled?: boolean;
  resultTimeoutMs?: number;
  onResult?: (result: VoiceResult) => void;
}

interface PushToTalkState {
  phase: PushToTalkPhase;
  error?: string;
  readback?: string;
  isActive: boolean;
  buttonProps: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  };
}

export function usePushToTalk(
  options: PushToTalkOptions = {},
): PushToTalkState {
  const {
    holdKey = "Space",
    enabled = true,
    resultTimeoutMs = 30_000,
    onResult,
  } = options;
  const capture = useCapture();
  const [sendPhase, setSendPhase] = useState<"idle" | "sending" | "error">(
    "idle",
  );
  const [sendError, setSendError] = useState<string | undefined>();
  const [readback, setReadback] = useState<string | undefined>();
  const inFlightRef = useRef(false);
  const pressingRef = useRef(false);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const startPress = useCallback(() => {
    if (!enabled || inFlightRef.current || pressingRef.current) {
      return;
    }

    stopReadback();
    pressingRef.current = true;
    setSendError(undefined);
    setSendPhase("idle");
    startPromiseRef.current = capture.start().finally(() => {
      startPromiseRef.current = null;
    });
  }, [capture, enabled]);

  const finishPress = useCallback(() => {
    if (!pressingRef.current) {
      return;
    }

    pressingRef.current = false;
    inFlightRef.current = true;

    void (async () => {
      try {
        await startPromiseRef.current;
        const audio = await capture.stop();
        if (!audio || audio.size === 0) {
          return;
        }

        setSendPhase("sending");

        const result = await withTimeout(
          postUtterance(audio, buildVoiceContext()),
          resultTimeoutMs,
        );
        setReadback(result.readback);
        onResultRef.current?.(result);
        await playReadback(result);
        setSendPhase("idle");
      } catch (cause) {
        setSendError(
          cause instanceof Error ? cause.message : "Voice utterance failed.",
        );
        setSendPhase("error");
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [capture, resultTimeoutMs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !isHoldKey(event, holdKey) ||
        !enabled ||
        event.repeat ||
        shouldSuppressKeyCapture(event.target)
      ) {
        return;
      }

      event.preventDefault();
      startPress();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (
        !isHoldKey(event, holdKey) ||
        shouldSuppressKeyCapture(event.target)
      ) {
        return;
      }

      event.preventDefault();
      finishPress();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, finishPress, holdKey, startPress]);

  const phase: PushToTalkPhase =
    sendPhase !== "idle"
      ? sendPhase
      : capture.phase === "listening"
        ? "listening"
        : capture.phase === "error"
          ? "error"
          : "idle";

  return {
    phase,
    error: sendError ?? capture.error,
    readback,
    isActive: capture.phase === "listening" || sendPhase === "sending",
    buttonProps: {
      onPointerDown: (event) => {
        if (!enabled) {
          return;
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
        startPress();
      },
      onPointerUp: (event) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        finishPress();
      },
      onPointerLeave: finishPress,
      onPointerCancel: finishPress,
    },
  };
}

function buildVoiceContext(): VoiceContext {
  const { selectedId, needsMe } = useStore.getState();
  return {
    ...(selectedId ? { selectedId } : {}),
    needsMeIds: needsMe.map((item) => item.id),
  };
}

function isHoldKey(event: KeyboardEvent, holdKey: string): boolean {
  return event.key === holdKey || event.code === holdKey;
}

function shouldSuppressKeyCapture(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Voice request timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
