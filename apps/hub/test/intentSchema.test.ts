import { describe, expect, test } from "bun:test";
import type { ItemId } from "@aspex/schema";
import { type JsonSchema, buildIntentSchema } from "../src/voice/intentSchema";

const selectedId: ItemId = "github:pr:brocorp/aspex#49";
const firstNeedsMeId: ItemId = "github:pr:brocorp/aspex#50";
const secondNeedsMeId: ItemId = "github:pr:brocorp/aspex#51";

describe("buildIntentSchema", () => {
  test("permits only first-stage intent branches", () => {
    const schema = buildIntentSchema({
      selectedId,
      needsMeIds: [firstNeedsMeId],
      selectedActions: ["approve", "comment"],
    });

    const kinds = constValuesForKey(schema, "kind");

    expect(new Set(kinds)).toEqual(
      new Set(["action", "dictate", "nav", "read", "open", "no_match"]),
    );
    expect(kinds).not.toContain("confirm");
    expect(kinds).not.toContain("dictation_body");
    expect(kinds).not.toContain("post");
  });

  test("constrains every item, action, and target reference with enums", () => {
    const schema = buildIntentSchema({
      selectedId,
      needsMeIds: [firstNeedsMeId, secondNeedsMeId],
      selectedActions: ["approve", "comment"],
    });
    const referenceFields = fieldSchemasForKeys(schema, [
      "itemId",
      "actionId",
      "target",
      "id",
    ]);

    expect(referenceFields.length).toBeGreaterThan(0);
    for (const field of referenceFields) {
      expect(field).toHaveProperty("enum");
      expect(field).not.toEqual({ type: "string" });
      expect(field.type).not.toBe("string");
    }
  });

  test("dedupes ids with selected id first and action enums are selected-actions only", () => {
    const schema = buildIntentSchema({
      selectedId,
      needsMeIds: [firstNeedsMeId, selectedId, secondNeedsMeId],
      selectedActions: ["approve", "merge", "approve"],
    });

    expect(propertySchemaForKind(schema, "action", "itemId")).toEqual({
      enum: [selectedId, firstNeedsMeId, secondNeedsMeId],
    });
    expect(propertySchemaForKind(schema, "action", "actionId")).toEqual({
      enum: ["approve", "merge"],
    });
    expect(allEnumValues(schema)).not.toContain("request_changes");
  });

  test("dictate is limited to comment and request_changes intersection", () => {
    const schema = buildIntentSchema({
      selectedId,
      needsMeIds: [firstNeedsMeId],
      selectedActions: ["approve", "comment", "request_changes", "merge"],
    });

    expect(propertySchemaForKind(schema, "dictate", "actionId")).toEqual({
      enum: ["comment", "request_changes"],
    });
  });

  test("drops id-bearing branches when there are no live ids", () => {
    const schema = buildIntentSchema({
      needsMeIds: [],
      selectedActions: ["approve", "comment"],
    });

    expect(constValuesForKey(schema, "kind")).toEqual(["nav", "no_match"]);
    expect(constValuesForKey(schema, "type")).toEqual(["show_needs_me"]);
    expect(
      fieldSchemasForKeys(schema, ["itemId", "actionId", "target", "id"]),
    ).toEqual([]);
  });

  test("drops action and dictate when selected actions are empty", () => {
    const schema = buildIntentSchema({
      selectedId,
      needsMeIds: [firstNeedsMeId],
      selectedActions: [],
    });

    expect(constValuesForKey(schema, "kind")).toEqual([
      "nav",
      "read",
      "open",
      "no_match",
    ]);
  });

  test("always includes abstain as unknown_command no_match", () => {
    const withIds = buildIntentSchema({
      selectedId,
      needsMeIds: [firstNeedsMeId],
      selectedActions: ["approve"],
    });
    const withoutIds = buildIntentSchema({
      needsMeIds: [],
      selectedActions: [],
    });

    expect(propertySchemaForKind(withIds, "no_match", "reason")).toEqual({
      const: "unknown_command",
    });
    expect(propertySchemaForKind(withIds, "no_match", "heard")).toEqual({
      const: "",
    });
    expect(propertySchemaForKind(withoutIds, "no_match", "reason")).toEqual({
      const: "unknown_command",
    });
  });
});

function constValuesForKey(schema: unknown, key: string): unknown[] {
  const values: unknown[] = [];
  walk(schema, (node) => {
    if (isRecord(node) && isRecord(node.properties)) {
      const property = node.properties[key];
      if (isRecord(property) && "const" in property) {
        values.push(property.const);
      }
    }
  });
  return values;
}

function fieldSchemasForKeys(
  schema: unknown,
  keys: string[],
): Record<string, unknown>[] {
  const fields: Record<string, unknown>[] = [];
  walk(schema, (node) => {
    if (!isRecord(node) || !isRecord(node.properties)) {
      return;
    }
    for (const key of keys) {
      const property = node.properties[key];
      if (isRecord(property)) {
        fields.push(property);
      }
    }
  });
  return fields;
}

function propertySchemaForKind(
  schema: JsonSchema,
  kind: string,
  property: string,
): unknown {
  const branch = topLevelBranches(schema).find(
    (candidate) =>
      isRecord(candidate.properties) &&
      isRecord(candidate.properties.kind) &&
      candidate.properties.kind.const === kind,
  );

  expect(branch).toBeDefined();
  expect(branch?.properties).toBeDefined();
  return branch?.properties[property];
}

function allEnumValues(schema: unknown): unknown[] {
  const values: unknown[] = [];
  walk(schema, (node) => {
    if (isRecord(node) && Array.isArray(node.enum)) {
      values.push(...node.enum);
    }
  });
  return values;
}

function topLevelBranches(schema: JsonSchema): Record<string, unknown>[] {
  expect(Array.isArray(schema.oneOf)).toBe(true);
  return (schema.oneOf as unknown[]).filter(isRecord);
}

function walk(value: unknown, visit: (node: unknown) => void): void {
  visit(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      walk(entry, visit);
    }
    return;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      walk(entry, visit);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
