export class MemoryLifecycleManager {


 prune(
  memories:any[]
 ){

  return memories.filter(
   Boolean
  );

 }


}
