#!/data/data/com.termux/files/usr/bin/bash

set -e

BASE="packages/intelligence/code-intelligence/impact"

mkdir -p "$BASE"

cat > "$BASE/ImpactNode.ts" <<'TS'
export type ImpactType =
  | "file-change"
  | "function-change"
  | "api-change"
  | "database-change";

export interface ImpactNode {
  id: string;
  type: ImpactType;
  name: string;
  affectedNodes: string[];
  riskScore: number;
}
TS


cat > "$BASE/ImpactAnalyzer.ts" <<'TS'
import { ImpactNode } from "./ImpactNode.js";

export class ImpactAnalyzer {

  analyze(
    changedNode: string,
    dependencies: string[]
  ): ImpactNode {

    const riskScore =
      Math.min(
        dependencies.length * 10,
        100
      );

    return {
      id: crypto.randomUUID(),
      type: "file-change",
      name: changedNode,
      affectedNodes: dependencies,
      riskScore
    };
  }

}
TS


cat > "$BASE/index.ts" <<'TS'
export * from "./ImpactNode.js";
export * from "./ImpactAnalyzer.js";
TS


echo "✅ Impact Intelligence Layer installed"
