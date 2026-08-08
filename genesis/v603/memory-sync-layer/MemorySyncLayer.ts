export class MemorySyncLayer {

 sync(nodes:any[]){

  return {
   synchronized:true,
   nodes:nodes.length
  };

 }

}
