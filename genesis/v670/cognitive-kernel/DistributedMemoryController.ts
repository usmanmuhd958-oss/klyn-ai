import { MemoryIntelligence } from "./MemoryIntelligence";

export class DistributedMemoryController {

 synchronize(data:any){

   return new MemoryIntelligence()
    .process(data);

 }

}
