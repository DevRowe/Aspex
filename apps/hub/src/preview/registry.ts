import { type ItemId, type PreviewSpec, parsePreviewSpec } from "@aspex/schema";

export interface PreviewRegistry {
  list(): PreviewSpec[];
  get(specId: string): PreviewSpec | undefined;
  byItem(itemId: ItemId): PreviewSpec[];
}

export interface RegistryError {
  index: number;
  specId?: string;
  message: string;
}

export function loadPreviewRegistry(rawSpecs: unknown[]): {
  registry: PreviewRegistry;
  errors: RegistryError[];
} {
  const specs: PreviewSpec[] = [];
  const byId = new Map<string, PreviewSpec>();
  const errors: RegistryError[] = [];

  rawSpecs.forEach((raw, index) => {
    let parsed: PreviewSpec;

    try {
      parsed = parsePreviewSpec(raw);
    } catch (error) {
      errors.push({
        index,
        message: errorMessage(error),
      });
      return;
    }

    if (byId.has(parsed.id)) {
      errors.push({
        index,
        specId: parsed.id,
        message: `Duplicate PreviewSpec id: ${parsed.id}`,
      });
      return;
    }

    const spec = freezeSpec(parsed);
    byId.set(spec.id, spec);
    specs.push(spec);
  });

  return {
    registry: createPreviewRegistry(specs, byId),
    errors,
  };
}

function createPreviewRegistry(
  specs: PreviewSpec[],
  byId: Map<string, PreviewSpec>,
): PreviewRegistry {
  const orderedSpecs = Object.freeze([...specs]);
  const specsById = new Map(byId);

  return {
    list: () => [...orderedSpecs],
    get: (specId) => specsById.get(specId),
    byItem: (itemId) => orderedSpecs.filter((spec) => spec.itemId === itemId),
  };
}

function freezeSpec(spec: PreviewSpec): PreviewSpec {
  const frozen: PreviewSpec = {
    ...spec,
    ...(spec.env === undefined ? {} : { env: Object.freeze({ ...spec.env }) }),
    ...(spec.limits === undefined
      ? {}
      : { limits: Object.freeze({ ...spec.limits }) }),
  };

  return Object.freeze(frozen);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
