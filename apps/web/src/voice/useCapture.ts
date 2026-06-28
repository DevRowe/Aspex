import { useCallback, useRef, useState } from "react";

export type CapturePhase = "idle" | "listening" | "error";

interface CaptureState {
  phase: CapturePhase;
  error?: string;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
}

export function useCapture(): CaptureState {
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [error, setError] = useState<string | undefined>();
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopPromiseRef = useRef<Promise<Blob | null> | null>(null);

  const getStream = useCallback(async () => {
    if (streamRef.current) {
      return streamRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not available in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    return stream;
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current?.state === "recording") {
      return;
    }

    try {
      const stream = await getStream();
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start();
      setError(undefined);
      setPhase("listening");
    } catch (cause) {
      const message =
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : cause instanceof Error
            ? cause.message
            : "Unable to start microphone capture.";
      setError(message);
      setPhase("error");
    }
  }, [getStream]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      setPhase((current) => (current === "listening" ? "idle" : current));
      return null;
    }

    if (stopPromiseRef.current) {
      return stopPromiseRef.current;
    }

    stopPromiseRef.current = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, {
                type: recorder.mimeType || "audio/webm",
              })
            : null;
        chunksRef.current = [];
        recorderRef.current = null;
        stopPromiseRef.current = null;
        setPhase("idle");
        resolve(blob);
      };

      recorder.stop();
    });

    return stopPromiseRef.current;
  }, []);

  return { phase, error, start, stop };
}
