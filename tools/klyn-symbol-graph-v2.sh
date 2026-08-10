#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN SYMBOL GRAPH V2"
echo " KNOWLEDGE GRAPH BUILDER"
echo "=============================="

ROOT="$HOME/klyn-ai-os"

cd "$ROOT"

mkdir -p .klyn/brain

BACKUP="backups/klyn-symbol-graph-v2"
mkdir -p "$BACKUP"

cp .klyn/symbol-map.json "$BACKUP/" 2>/dev/null || true
cp .klyn/dependency-map.json "$BACKUP/" 2>/dev/null || true
cp .klyn/impact-map.json "$BACKUP/" 2>/dev/null || true


node <<'EOF'

import fs from "fs";

const read = (f)=> {
  try {
    return JSON.parse(fs.readFileSync(f,"utf8"));
  } catch {
    return {};
  }
};


const symbols = read(".klyn/symbol-map.json");
const deps = read(".klyn/dependency-map.json");
const impact = read(".klyn/impact-map.json");


const graph = {
  version:"KLYN-GRAPH-V2",

  generated:new Date().toISOString(),

  nodes:[],

  edges:[]
};


function addNode(id,type,data={}) {
 graph.nodes.push({
   id,
   type,
   ...data
 });
}


for(const s of Object.keys(symbols)){
 addNode(
   s,
   "symbol",
   {
    source:"symbol-map"
   }
 );
}


for(const d of Object.keys(deps)){
 graph.edges.push({
   from:d,
   to:"dependency",
   relation:"depends_on"
 });
}


for(const i of Object.keys(impact)){
 graph.edges.push({
   from:i,
   to:"impact",
   relation:"affects"
 });
}


fs.writeFileSync(
 ".klyn/brain/symbol.graph.json",
 JSON.stringify(graph,null,2)
);


console.log(
`GRAPH NODES: ${graph.nodes.length}`
);

console.log(
`GRAPH EDGES: ${graph.edges.length}`
);

EOF


echo "=============================="
echo " SYMBOL GRAPH READY"
echo " OUTPUT:"
echo ".klyn/brain/symbol.graph.json"
echo "=============================="
