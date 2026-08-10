#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN CODE INTELLIGENCE V1"
echo " AUTONOMOUS ANALYSIS LAYER"
echo "=============================="

cd "$HOME/klyn-ai-os"

mkdir -p .klyn/brain
mkdir -p backups/klyn-code-intelligence-v1

cp .klyn/brain/reasoning-report.json backups/klyn-code-intelligence-v1/ 2>/dev/null || true


node <<'EOF'

import fs from "fs";


function load(file){
 try{
  return JSON.parse(fs.readFileSync(file,"utf8"));
 }catch{
  return {};
 }
}


const reasoning =
load(".klyn/brain/reasoning-report.json");


const graph =
load(".klyn/brain/symbol.graph.json");


const intelligence={

 version:"KLYN-CODE-INTELLIGENCE-V1",

 timestamp:new Date().toISOString(),

 system:{
   symbols:reasoning.intelligence?.nodes || 0,
   edges:reasoning.intelligence?.edges || 0
 },

 analysis:{
   criticalComponents:[],
   recommendations:[]
 }

};


const risks =
reasoning.architecture?.riskZones || [];


intelligence.analysis.criticalComponents =
risks.map(r=>({

 symbol:r.symbol,
 connections:r.connections,
 importance:
   r.connections > 10
   ? "HIGH"
   : "MEDIUM"

}));


if(graph.nodes){

 intelligence.analysis.recommendations.push(
  "Maintain dependency awareness before code modification"
 );

 intelligence.analysis.recommendations.push(
  "Use impact analysis before applying patches"
 );

 intelligence.analysis.recommendations.push(
  "Protect high connectivity symbols"
 );

}


fs.writeFileSync(
 ".klyn/brain/code-intelligence.json",
 JSON.stringify(intelligence,null,2)
);


console.log(
"INTELLIGENCE SYMBOLS:",
intelligence.system.symbols
);

console.log(
"CRITICAL COMPONENTS:",
intelligence.analysis.criticalComponents.length
);

EOF


echo "=============================="
echo " CODE INTELLIGENCE READY"
echo " CREATED:"
echo ".klyn/brain/code-intelligence.json"
echo "=============================="

