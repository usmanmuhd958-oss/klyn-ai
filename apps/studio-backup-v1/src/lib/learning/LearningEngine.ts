
import type { LearningEvent, AgentMemory } from "@/components/learning/learning.types";


const memory = new Map<string, AgentMemory>();


export function recordLearning(event:LearningEvent){

 const current =
 memory.get(event.agentId) ??
 {
  agentId:event.agentId,
  executions:0,
  successes:0,
  failures:0,
  intelligenceScore:0,
  lastImprovement:Date.now()
 };


 current.executions++;

 if(event.type==="success"){
   current.successes++;
 }

 if(event.type==="failure"){
   current.failures++;
 }


 current.intelligenceScore =
 Math.max(
 0,
 ((current.successes /
 current.executions) * 100)
 );


 current.lastImprovement = Date.now();


 memory.set(event.agentId,current);

 return current;

}



export function getAgentLearning(agentId:string){

 return memory.get(agentId);

}


export function getLearningMemory(){

 return Array.from(memory.values());

}

