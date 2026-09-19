import {
  assertCanonicalizable,
  type JsonValue,
} from "@klyn/governance";

export function toJsonValue(value: unknown): JsonValue {
  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error("value cannot be serialized as JSON", { cause: error });
  }

  if (serialized === undefined) {
    throw new Error("value cannot be serialized as JSON");
  }

  const normalized: unknown = JSON.parse(serialized);
  assertCanonicalizable(normalized);
  return normalized;
}
