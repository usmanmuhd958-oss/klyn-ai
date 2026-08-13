#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="packages/intelligence/code-intelligence/impact"

mkdir -p "$ROOT"

cat > "$ROOT/ImpactEngine.ts" <<'TS'
import { CodeGraphEngine } from "../graph/CodeGraphEngine.js";
import { GraphNode } from "../graph/GraphNode.js";

export class ImpactEngine {

  constructor(
    private graph: CodeGraphEngine
  ) {}

  analyzeChange(nodeId: string): GraphNode[] {

    return this.graph.analyzeDependencies(nodeId);

  }

}
TS

cat > "$ROOT/index.ts" <<'TS'
export * from "./ImpactEngine.js";
TS

echo "✅ Impact Intelligence Core installed"
