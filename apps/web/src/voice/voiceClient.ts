import type { VoiceContext, VoiceResult } from "@aspex/schema";
import { getHubUrl } from "../lib/hubClient";

let readbackAudio: HTMLAudioElement | undefined;
let readbackObjectUrl: string | undefined;

export async function postUtterance(
  audioBlob: Blob,
  context: VoiceContext,
): Promise<VoiceResult> {
  const hub = await getHubUrl();
  const formData = new FormData();
  formData.append("audio", audioBlob, "utterance.webm");
  formData.append("context", JSON.stringify(context));

  const response = await fetch(`${hub}/voice/utterance`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Voice utterance failed (${response.status} ${response.statusText})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  return (await response.json()) as VoiceResult;
}

export async function playReadback(result: VoiceResult): Promise<void> {
  if (!result.audioUrl) {
    return;
  }

  stopReadback();

  const hub = await getHubUrl();
  const response = await fetch(resolveAudioUrl(hub, result.audioUrl));

  if (!response.ok) {
    throw new Error(
      `Voice read-back failed (${response.status} ${response.statusText})`,
    );
  }

  const audioBlob = await response.blob();
  readbackObjectUrl = URL.createObjectURL(audioBlob);
  readbackAudio = new Audio(readbackObjectUrl);
  readbackAudio.onended = clearObjectUrl;
  readbackAudio.onerror = clearObjectUrl;

  try {
    await readbackAudio.play();
  } catch (cause) {
    readbackAudio = undefined;
    clearObjectUrl();
    throw cause;
  }
}

export function stopReadback(): void {
  if (readbackAudio) {
    readbackAudio.pause();
    readbackAudio.currentTime = 0;
    readbackAudio = undefined;
  }

  clearObjectUrl();
}

function resolveAudioUrl(hub: string, audioUrl: string): string {
  return new URL(audioUrl, hub).toString();
}

function clearObjectUrl(): void {
  if (readbackObjectUrl) {
    URL.revokeObjectURL(readbackObjectUrl);
    readbackObjectUrl = undefined;
  }
}
