import type { ContextAnchor, ContextLedgerEntry, ContextWindow } from "./contracts.js";

const stableSerialize = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number cannot be serialized");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported value type: ${typeof value}`);
};

export class ContextLedger {
  private readonly entries: ContextLedgerEntry[] = [];

  append(input: {
    readonly kind: ContextLedgerEntry["kind"];
    readonly sourceId: string;
    readonly content: string;
    readonly anchors?: readonly ContextAnchor[];
    readonly auditHash?: string | null;
  }): ContextLedgerEntry {
    const entry: ContextLedgerEntry = Object.freeze({
      sequence: this.entries.length,
      kind: input.kind,
      sourceId: input.sourceId,
      content: input.content,
      truncated: false,
      anchors: [...(input.anchors ?? [])].sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right))),
      auditHash: input.auditHash ?? null,
    });
    this.entries.push(entry);
    return entry;
  }

  snapshot(): readonly ContextLedgerEntry[] {
    return this.entries.map((entry) => ({ ...entry, anchors: [...entry.anchors] }));
  }

  buildWindow(maxChars: number): ContextWindow {
    if (!Number.isInteger(maxChars) || maxChars <= 0) throw new RangeError("maxChars must be a positive integer");
    const selected: ContextLedgerEntry[] = [];
    let remaining = maxChars;
    let omittedEntries = 0;

    for (const entry of this.entries) {
      const canonical = stableSerialize(entry);
      if (canonical.length <= remaining) {
        selected.push(entry);
        remaining -= canonical.length;
        continue;
      }

      if (remaining > 0) {
        const reserve = stableSerialize({
          sequence: entry.sequence,
          kind: entry.kind,
          sourceId: entry.sourceId,
          anchors: entry.anchors,
          auditHash: entry.auditHash,
        });
        if (reserve.length < remaining) {
          const prefixBudget = Math.max(0, remaining - reserve.length - 32);
          const content = entry.content.slice(0, prefixBudget);
          selected.push(Object.freeze({
            ...entry,
            content,
            truncated: true,
          }));
          remaining = 0;
        }
      }
      omittedEntries += 1;
    }

    const serialized = stableSerialize(selected);
    return Object.freeze({
      entries: selected,
      serialized,
      omittedEntries,
    });
  }
}

export const canonicalSerializeContext = (window: ContextWindow): string => stableSerialize(window);
