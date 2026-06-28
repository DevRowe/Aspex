import type { Preview, PreviewSpec } from "@aspex/schema";
import { useEffect } from "react";
import { create } from "zustand";
import { getHubConfig } from "../lib/hubClient";
import {
  PreviewsDisabledError,
  boot,
  listPreviews,
  listSpecs,
  stop,
} from "./previewClient";

interface PreviewStore {
  enabled: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  specs: PreviewSpec[];
  previews: Preview[];
  focusedPreviewId: string | null;
  load: () => Promise<void>;
  upsertPreview: (preview: Preview) => void;
  focusPreview: (previewId: string | null) => void;
  bootSpec: (specId: string) => Promise<Preview>;
  focusOrBootSpec: (specId: string) => Promise<Preview>;
  stopPreview: (previewId: string) => Promise<void>;
  rebootPreview: (preview: Preview) => Promise<Preview>;
}

const bootableStates = new Set<Preview["state"]>(["booting", "ready"]);

export const usePreviewStore = create<PreviewStore>((set, get) => ({
  enabled: false,
  loaded: false,
  loading: false,
  error: null,
  specs: [],
  previews: [],
  focusedPreviewId: null,
  load: async () => {
    set({ loading: true, error: null });

    try {
      const config = await getHubConfig().catch(() => null);
      if (config?.previews?.enabled === false) {
        set({
          enabled: false,
          loaded: true,
          loading: false,
          error: null,
          specs: [],
          previews: [],
          focusedPreviewId: null,
        });
        return;
      }

      const [specs, previews] = await Promise.all([
        listSpecs(),
        listPreviews(),
      ]);
      set({
        enabled: true,
        loaded: true,
        loading: false,
        error: null,
        specs,
        previews,
      });
    } catch (error) {
      if (error instanceof PreviewsDisabledError) {
        set({
          enabled: false,
          loaded: true,
          loading: false,
          error: null,
          specs: [],
          previews: [],
          focusedPreviewId: null,
        });
        return;
      }

      set({
        enabled: false,
        loaded: true,
        loading: false,
        error: error instanceof Error ? error.message : "Preview load failed",
        specs: [],
        previews: [],
        focusedPreviewId: null,
      });
    }
  },
  upsertPreview: (preview) =>
    set((state) => {
      const previews = state.previews.filter(
        (existing) => existing.previewId !== preview.previewId,
      );
      previews.unshift(preview);
      return { enabled: true, previews };
    }),
  focusPreview: (previewId) => set({ focusedPreviewId: previewId }),
  bootSpec: async (specId) => {
    const spec = get().specs.find((candidate) => candidate.id === specId);

    if (spec?.trust === "untrusted") {
      throw new Error("pixels lane not yet available");
    }

    const preview = await boot(specId);
    get().upsertPreview(preview);
    set({ focusedPreviewId: preview.previewId });
    return preview;
  },
  focusOrBootSpec: async (specId) => {
    const existing = get().previews.find(
      (preview) =>
        preview.specId === specId && bootableStates.has(preview.state),
    );

    if (existing !== undefined) {
      set({ focusedPreviewId: existing.previewId });
      return existing;
    }

    return get().bootSpec(specId);
  },
  stopPreview: async (previewId) => {
    await stop(previewId);

    const existing = get().previews.find(
      (preview) => preview.previewId === previewId,
    );

    if (existing !== undefined) {
      get().upsertPreview({ ...existing, state: "stopped" });
    }
  },
  rebootPreview: async (preview) => {
    try {
      await get().stopPreview(preview.previewId);
    } catch {
      // A crashed or reaped Preview may already be gone; boot remains explicit.
    }

    return get().bootSpec(preview.specId);
  },
}));

export function usePreviews(): void {
  useEffect(() => {
    void usePreviewStore.getState().load();
  }, []);
}
