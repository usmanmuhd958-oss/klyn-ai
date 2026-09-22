import {MemoryStore} from "./MemoryStore.js";
import {ExperienceIndexer} from "./ExperienceIndexer.js";


export class LearningMemoryEngine {


  store = new MemoryStore();

  indexer = new ExperienceIndexer();


  learn(data:any){

    const indexed =
      this.indexer.index(data);


    return this.store.save(indexed);

  }


}
