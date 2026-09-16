export class MemoryIndexEngine {

 index:any={};

 add(key:string,value:any){

  this.index[key]=value;

 }

}
