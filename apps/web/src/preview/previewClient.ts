import type { Preview, PreviewSpec } from "@aspex/schema";
import { getHubUrl } from "../lib/hubClient";

export class PreviewsDisabledError extends Error {
  constructor() {
    super("Preview Deck disabled");
  }
}

export async function listSpecs(): Promise<PreviewSpec[]> {
  return request<PreviewSpec[]>("/previews/specs", undefined, {
    disabledOnNotFound: true,
  });
}

export async function listPreviews(): Promise<Preview[]> {
  return request<Preview[]>("/previews", undefined, {
    disabledOnNotFound: true,
  });
}

export async function boot(specId: string): Promise<Preview> {
  return request<Preview>("/previews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ specId }),
  });
}

export async function stop(previewId: string): Promise<void> {
  await request<void>(`/previews/${encodeURIComponent(previewId)}`, {
    method: "DELETE",
  });
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options: { disabledOnNotFound?: boolean } = {},
): Promise<T> {
  const hub = await getHubUrl();
  const response = await fetch(`${hub}${path}`, init);

  if (response.status === 404 && options.disabledOnNotFound === true) {
    throw new PreviewsDisabledError();
  }

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(
      `Preview request failed (${response.status} ${response.statusText})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");

  if (text.trim() === "") {
    return "";
  }

  try {
    const body = JSON.parse(text) as { message?: unknown };
    return typeof body.message === "string" ? body.message : text;
  } catch {
    return text;
  }
}
