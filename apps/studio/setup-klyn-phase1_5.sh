#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Bootstrapping Klyn Studio Phase 1.5: Intent-Native Agentic IDE"

ROOT="$(pwd)"

mkdir -p \
  packages/software-graph/src \
  packages/intent-engine/src \
  packages/neural-planner/src \
  packages/verification-engine/src \
  apps/web/app \
  apps/web/components/canvas \
  apps/web/components/layout \
  apps/web/components/panels \
  apps/web/components/ui \
  apps/web/lib

cat << 'EOF' > package.json
{
  "name": "klyn-studio",
  "private": true,
  "scripts": {
    "dev": "npm --workspace apps/web run dev",
    "build": "npm --workspace apps/web run build",
    "typecheck": "npm --workspace apps/web run typecheck"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
EOF

cat << 'EOF' > packages/software-graph/src/ASTGraph.ts
export interface ASTNode {
  id: string;
  type: string;
  name: string;
  children: string[];
}

export class ASTGraph {
  private nodes = new Map<string, ASTNode>();

  addNode(node: ASTNode) {
    this.nodes.set(node.id, node);
  }

  connect(parentId: string, childId: string) {
    const parent = this.nodes.get(parentId);
    if (!parent) return;

    parent.children.push(childId);
  }

  getGraph() {
    return Array.from(this.nodes.values());
  }
}
EOF

cat << 'EOF' > packages/software-graph/src/SymbolIndexer.ts
export interface SymbolEntry {
  name: string;
  file: string;
  type: string;
}

export class SymbolIndexer {
  private symbols: SymbolEntry[] = [];

  index(symbol: SymbolEntry) {
    this.symbols.push(symbol);
  }

  search(query: string) {
    return this.symbols.filter(symbol =>
      symbol.name.toLowerCase().includes(query.toLowerCase())
    );
  }
}
EOF

cat << 'EOF' > packages/intent-engine/src/IntentParser.ts
export interface IntentSpecification {
  goal: string;
  requirements: string[];
  confidence: number;
}

export class IntentParser {
  parse(input: string): IntentSpecification {
    return {
      goal: input,
      requirements: input
        .split(".")
        .map(item => item.trim())
        .filter(Boolean),
      confidence: 0.92
    };
  }
}
EOF

cat << 'EOF' > packages/intent-engine/src/SpecRefiner.ts
import type { IntentSpecification } from "./IntentParser";

export class SpecRefiner {
  refine(spec: IntentSpecification) {
    return {
      ...spec,
      verified: true,
      questions: [
        "Who are the primary users?",
        "What security boundaries exist?"
      ]
    };
  }
}
EOF

cat << 'EOF' > packages/neural-planner/src/MissionPlanner.ts
export interface Mission {
  title: string;
  tasks: string[];
}

export class MissionPlanner {
  create(title: string): Mission {
    return {
      title,
      tasks: [
        "Analyze intent",
        "Generate architecture",
        "Execute verification"
      ]
    };
  }
}
EOF

cat << 'EOF' > packages/neural-planner/src/TaskDecomposer.ts
export class TaskDecomposer {
  decompose(task: string) {
    return [
      {
        id: crypto.randomUUID(),
        task,
        agent: "architect"
      }
    ];
  }
}
EOF

cat << 'EOF' > packages/verification-engine/src/PropertyChecker.ts
export class PropertyChecker {
  check(target: unknown) {
    return {
      target,
      status: "verified",
      score: 1
    };
  }
}
EOF

cat << 'EOF' > apps/web/package.json
{
  "name": "klyn-web",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@xyflow/react": "^12.3.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.468.0",
    "next": "16.3.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
EOF

cat << 'EOF' > apps/web/app/globals.css
@import "tailwindcss";

:root {
  --background:#090D16;
  --cyan:#00F2FE;
  --blue:#4FACFE;
}

body {
  background:#090D16;
  color:white;
  overflow:hidden;
}

.glass {
  background:rgba(15,23,42,.55);
  backdrop-filter:blur(20px);
  border:1px solid rgba(0,242,254,.2);
}
EOF

cat << 'EOF' > apps/web/app/layout.tsx
import "./globals.css";

export default function RootLayout({
 children
}:{
 children:React.ReactNode
}) {
 return (
  <html>
   <body>{children}</body>
  </html>
 );
}
EOF

cat << 'EOF' > apps/web/components/canvas/SpatialIntentCanvas.tsx
"use client";

import {
 ReactFlow,
 Background,
 Controls,
 type Node,
 type Edge
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

const nodes:Node[]=[
 {
 id:"intent",
 position:{x:0,y:100},
 data:{label:"Intent Node\nBuild SaaS Platform"},
 className:"glass text-purple-300"
 },
 {
 id:"api",
 position:{x:250,y:100},
 data:{label:"Architecture API"},
 className:"glass text-cyan-300"
 },
 {
 id:"ast",
 position:{x:500,y:100},
 data:{label:"AST Symbol Graph"},
 className:"glass text-emerald-300"
 },
 {
 id:"guard",
 position:{x:750,y:100},
 data:{label:"Runtime Guard"},
 className:"glass text-amber-300"
 }
];

const edges:Edge[]=[
 {id:"a",source:"intent",target:"api"},
 {id:"b",source:"api",target:"ast"},
 {id:"c",source:"ast",target:"guard"}
];

export default function SpatialIntentCanvas(){

return (
<div className="h-full w-full">
<ReactFlow
nodes={nodes}
edges={edges}
fitView
>
<Background/>
<Controls/>
</ReactFlow>
</div>
);
}
EOF

cat << 'EOF' > apps/web/components/layout/Header.tsx
"use client";

import {Activity,Brain,Shield} from "lucide-react";

export default function Header(){

return (
<header className="glass h-16 flex items-center justify-between px-6">
<div className="text-xl font-bold text-cyan-300">
◈ KLYN STUDIO
</div>

<div className="flex gap-5 text-sm">
<span><Brain/> Architect Online</span>
<span><Activity/> Builder Active</span>
<span><Shield/> Guard Ready</span>
</div>

<div className="px-4 py-2 rounded-full border border-cyan-500/30">
Intent Verified
</div>

</header>
);
}
EOF

cat << 'EOF' > apps/web/components/panels/Sidebar.tsx
export default function Sidebar(){

return (
<aside className="glass w-72 p-5 space-y-6">

<h2 className="text-cyan-300">
Intent Explorer
</h2>

<textarea
className="w-full h-32 bg-black/30 rounded-xl p-3 border border-cyan-500/20"
placeholder="Describe your mission..."
/>

<div>
<h3>Requirement Graph</h3>
<ul className="text-sm text-slate-300">
<li>Authentication</li>
<li>API Architecture</li>
<li>Database Layer</li>
<li>Verification Rules</li>
</ul>
</div>

</aside>
);
}
EOF

cat << 'EOF' > apps/web/components/panels/AgentTerminal.tsx
export default function AgentTerminal(){

return (
<section className="glass w-96 p-5">

<h2 className="text-cyan-300">
Agent EventBus
</h2>

<div className="mt-5 text-xs text-green-300 space-y-2">
<div>[architect] analysing intent</div>
<div>[builder] generating graph</div>
<div>[guard] verification passed</div>
</div>

</section>
);
}
EOF

cat << 'EOF' > apps/web/components/ui/StatusBar.tsx
export default function StatusBar(){

return (
<div className="fixed bottom-5 left-5 right-5 glass rounded-2xl p-4 flex justify-between">
<span>Swarm: 3 Agents Online</span>
<span>Latent Intent: Active</span>

<div className="w-64 h-2 bg-slate-700 rounded">
<div className="h-full w-3/4 bg-cyan-400 rounded"/>
</div>

</div>
);
}
EOF

cat << 'EOF' > apps/web/app/page.tsx
import Header from "../components/layout/Header";
import Sidebar from "../components/panels/Sidebar";
import AgentTerminal from "../components/panels/AgentTerminal";
import SpatialIntentCanvas from "../components/canvas/SpatialIntentCanvas";
import StatusBar from "../components/ui/StatusBar";

export default function Page(){

return (
<main className="h-screen flex flex-col gap-3 p-3">

<Header/>

<div className="flex flex-1 gap-3">

<Sidebar/>

<div className="flex-1 glass rounded-2xl">
<SpatialIntentCanvas/>
</div>

<AgentTerminal/>

</div>

<StatusBar/>

</main>
);
}
EOF

echo "✅ Klyn Studio Phase 1.5 scaffold completed."
echo "Run:"
echo "cd apps/web && npm install && npm run dev"
