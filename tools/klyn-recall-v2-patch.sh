#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

cp index.js backups/klyn-memory-v2/index.js.recall-v2.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("index.js")
s = p.read_text()

old = '''    const sim = cosineSimilarity(embedding, m.embedding);
    if (sim >= threshold) scored.push({ ...m, similarity: sim, score: sim });'''

new = '''    const sim = cosineSimilarity(embedding, m.embedding);

    let boost = 0;

    try {
      const text = JSON.stringify(m.payload).toLowerCase();
      const tags = (m.tags || []).join(" ").toLowerCase();

      if (text.includes("klyn")) boost += 0.15;
      if (text.includes("server")) boost += 0.15;
      if (tags.includes("ast")) boost += 0.05;
    } catch {}

    const score = sim + boost;

    if (score >= threshold) {
      scored.push({ ...m, similarity: sim, score });
    }'''

if old not in s:
    raise SystemExit("target block not found")

p.write_text(s.replace(old,new))

print("RECALL V2 PATCHED")
PY

node --check index.js

echo "READY"
