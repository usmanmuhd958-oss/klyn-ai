import { EpisodicMemory } from "./EpisodicMemory";
import { SemanticMemory } from "./SemanticMemory";

export class LongTermMemory {

  episodic = new EpisodicMemory();

  semantic = new SemanticMemory();


  remember(event:string, context:any){

    this.episodic.store({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      event,
      context
    });

  }


  learn(concept:string, information:string){

    this.semantic.learn({
      id: crypto.randomUUID(),
      concept,
      information,
      relations:[]
    });

  }

}
