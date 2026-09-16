import { ShortTermMemory } from "./ShortTermMemory";
import { LongTermMemory } from "./LongTermMemory";
import { SemanticMemory } from "./SemanticMemory";
import { EpisodicMemory } from "./EpisodicMemory";

export class MemoryIntelligence {

 process(data:any){

   return {
    short:new ShortTermMemory().store(data),
    long:new LongTermMemory().persist(data),
    semantic:new SemanticMemory().index("knowledge"),
    episodic:new EpisodicMemory().record(data)
   };

 }

}
