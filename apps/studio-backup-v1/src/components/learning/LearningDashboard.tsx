
"use client";

import {getLearningMemory}
from "@/lib/learning/LearningEngine";

export default function LearningDashboard(){

 const agents=getLearningMemory();


 return (

 <div className="glass-panel rounded-md p-3 font-mono">

 <div className="text-xs uppercase">
 continuous learning loop
 </div>


 {
 agents.map(agent=>(

 <div key={agent.agentId}
 className="mt-2 text-[10px]">

 {agent.agentId}

 <br/>

 intelligence:
 {agent.intelligenceScore.toFixed(2)}%

 </div>

 ))

 }


 {
 agents.length===0 &&
 <div className="text-[10px]">
 awaiting execution memory...
 </div>
 }


 </div>

 );

}

