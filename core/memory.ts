/**
 * =============================================================================
 * KLYN AI OS — Core Memory Bridge
 * File: core/memory.ts
 *
 * Restores the legacy memory surface consumed by 4.loops/healer.ts:
 *   - `saveMemory(entry)`          persist an error-fix entry
 *   - `getMemory(errorHash)`       O(1) exact-hash lookup
 *   - `findSimilarError(hash, msg)` exact hash first, then deterministic
 *                                  token-overlap similarity over saved fixes
 *
 * The `MemoryEngine` substrate (intelligence/memory/MemoryEngine.ts) remains
 * exported for backwards compatibility, and `memoryEngine` is now a real
 * singleton (previously re-exported without existing).
 * =============================================================================
 */

import { MemoryEngine, type MemoryRecord } from '../intelligence/memory/MemoryEngine.js';

export { MemoryEngine };
export type { MemoryRecord };

export interface MemoryEntry {
  errorHash: string;
  errorMessage: string;
  filePath: string;
  fix: string;
  modelUsed: string;
  success: boolean;
  timeTaken: number;
  timestamp: number;
  successRate: number;
}

const ERROR_TYPE = 'error-fix';
const MAX_ENTRIES = 512;

/** Canonical engine singleton. */
export const memoryEngine = new MemoryEngine();

/** O(1) hash-keyed index over saved fixes. */
const byHash = new Map<string, MemoryEntry>();

/** Persist an error-fix entry for later recall. */
export async function saveMemory(entry: MemoryEntry): Promise<void> {
  const now = Date.now();
  byHash.set(entry.errorHash, { ...entry, timestamp: now });

  // Bounded store: drop the oldest insertion when at capacity.
  if (byHash.size > MAX_ENTRIES) {
    const oldestKey = byHash.keys().next().value as string | undefined;
    if (oldestKey !== undefined) byHash.delete(oldestKey);
  }

  memoryEngine.store({ id: entry.errorHash, type: ERROR_TYPE, data: entry, created: now });
}

/** Exact error-hash lookup. */
export async function getMemory(errorHash: string): Promise<MemoryEntry | null> {
  return byHash.get(errorHash) ?? null;
}

/**
 * Find a previously saved fix: exact error-hash match first; otherwise rank
 * saved entries by token overlap against the error message (deterministic,
 * requires >= 0.5 relative overlap so weak matches are never returned).
 */
export async function findSimilarError(
  errorHash: string,
  errorMessage: string
): Promise<MemoryEntry | null> {
  const exact = byHash.get(errorHash);
  if (exact) return exact;

  const queryTokens = tokenize(errorMessage);
  let best: MemoryEntry | null = null;
  let bestScore = 0;

  for (const entry of byHash.values()) {
    const entryTokens = tokenize(entry.errorMessage);
    let overlap = 0;
    for (const token of queryTokens) {
      if (entryTokens.has(token)) overlap++;
    }
    const score = overlap / Math.max(1, Math.min(queryTokens.size, entryTokens.size));
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      best = entry;
    }
  }

  return best;
}

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (raw.length >= 3) tokens.add(raw);
  }
  return tokens;
}

export default memoryEngine;
