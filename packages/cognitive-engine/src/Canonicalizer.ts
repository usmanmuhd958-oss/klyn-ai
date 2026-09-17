import { createHash } from "node:crypto";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export function canonicalize(value: unknown): string {
  return canonicalizeValue(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not permit NaN or Infinity");
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => {
      if (item === undefined) return "null";
      return canonicalizeValue(item);
    }).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(record[key])}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical JSON value type: ${typeof value}`);
}
