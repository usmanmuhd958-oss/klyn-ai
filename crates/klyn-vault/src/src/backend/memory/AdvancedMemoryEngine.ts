import { EpisodicMemory } from "./EpisodicMemory.js";
import { SemanticMemory } from "./SemanticMemory.js";
import { ProceduralMemory } from "./ProceduralMemory.js";
import { MemoryContextFusion } from "./MemoryContextFusion.js";


export class AdvancedMemoryEngine {


 episodic =
  new EpisodicMemory();


 semantic =
  new SemanticMemory();


 procedural =
  new ProceduralMemory();


 fusion =
  new MemoryContextFusion();



 buildContext(){

  return this.fusion.fuse(

   this.episodic.recall(),

   [],

   []

  );

 }


}
