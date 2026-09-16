import {LearningMemoryEngine} from "./LearningMemoryEngine.js";
import {MemoryRetriever} from "./MemoryRetriever.js";


export class MemoryIntelligenceController {


  learning =
    new LearningMemoryEngine();


  retrieval =
    new MemoryRetriever();



  process(data:any){

    const memory =
      this.learning.learn(data);


    return {

      memory,

      status:"stored"

    };

  }


}
