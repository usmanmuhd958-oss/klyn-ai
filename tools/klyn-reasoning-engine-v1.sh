#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN REASONING ENGINE V1"
echo " ARCHITECTURE INTELLIGENCE"
echo "=============================="

ROOT="$HOME/klyn-ai-os"
cd "$ROOT"

mkdir -p .klyn/brain
mkdir -p backups/klyn-reasoning-v1

cp .klyn/brain/symbol.graph.json backups/klyn-reasoning-v1/ 2>/dev/null || true


node <<'EOF'

import fs from "fs";

const load=(p)=>{
 try{
  return JSON.parse(fs.readFileSync(p,"utf8"));
 }catch{
  return {};
 }
};


const graph=load(".klyn/brain/symbol.graph.json");


const report={

 version:"KLYN-REASONING-V1",

 generated:new Date().toISOString(),

 intelligence:{
   nodes:graph.nodes?.length || 0,
   edges:graph.edges?.length || 0
 },

 architecture:{
   layers:[],
   riskZones:[],
   observations:[]
 }

};


const nodes=graph.nodes || [];


const types={};

for(const n of nodes){

 types[n.type]=(types[n.type]||0)+1;

}


for(const [type,count] of Object.entries(types)){

 report.architecture.layers.push({
   type,
   count
 });

}


const edgeCount={};

for(const e of graph.edges || []){

 edgeCount[e.from]=(edgeCount[e.from]||0)+1;

}


const ranked=Object.entries(edgeCount)
.sort((a,b)=>b[1]-a[1])
.slice(0,20);


report.architecture.riskZones=
ranked.map(x=>({
 symbol:x[0],
 connections:x[1]
}));


report.architecture.observations.push(
 "KLYN graph analysis completed"
);


fs.writeFileSync(
 ".klyn/brain/reasoning-report.json",
 JSON.stringify(report,null,2)
);


console.log(
"REASONING NODES:",
report.intelligence.nodes
);

console.log(
"RISK SYMBOLS:",
report.architecture.riskZones.length
);


EOF


echo "=============================="
echo " REASONING ENGINE READY"
echo " CREATED:"
echo ".klyn/brain/reasoning-report.json"
echo "=============================="
