export class MemoryIndexManager {

 private index=new Map<string,string[]>();

 add(key:string,tags:string[]){

   this.index.set(key,tags);

 }

 search(tag:string){

   return [...this.index.entries()]
   .filter(([_,tags])=>tags.includes(tag));

 }

}
