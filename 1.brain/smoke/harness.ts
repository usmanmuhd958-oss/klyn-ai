let failures = 0;
let passes = 0;

export function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passes++;
    console.log(`PASS  ${name}${detail ? `  → ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

export function deepEqual(a: unknown, b: unknown, sortObjects = true): boolean {
  return JSON.stringify(sortObjects ? sortDeep(a) : a) === JSON.stringify(sortObjects ? sortDeep(b) : b);
}

export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function summary(phase: number): void {
  console.log(`\n=== PHASE ${phase} SMOKE SUMMARY: ${passes}/${passes + failures} checks passed ===`);
  if (failures > 0) process.exit(1);
}
