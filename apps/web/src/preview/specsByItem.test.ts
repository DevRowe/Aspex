import { describe, expect, test } from "bun:test";
import type { PreviewSpec } from "@aspex/schema";
import { getSpecsByItem } from "./specsByItem";

const spec = (id: string, itemId?: string): PreviewSpec => ({
  id,
  name: id,
  engine: "mock",
  image: `aspex/${id}:preview`,
  port: 5173,
  trust: "trusted",
  itemId,
});

describe("getSpecsByItem", () => {
  test("groups only bound Preview specs by item id", () => {
    const web = spec("web", "github:pr:bro/aspex#43");
    const docs = spec("docs", "github:pr:bro/aspex#43");
    const unbound = spec("unbound");

    const specsByItem = getSpecsByItem([web, docs, unbound]);

    expect(specsByItem.get("github:pr:bro/aspex#43")).toEqual([web, docs]);
    expect(specsByItem.has("unbound")).toBe(false);
  });

  test("memoizes by spec list reference", () => {
    const specs = [spec("web", "github:pr:bro/aspex#43")];

    expect(getSpecsByItem(specs)).toBe(getSpecsByItem(specs));
    expect(getSpecsByItem([...specs])).not.toBe(getSpecsByItem(specs));
  });
});
