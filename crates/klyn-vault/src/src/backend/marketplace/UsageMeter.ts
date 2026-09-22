export class UsageMeter {

 private usage:any[] = [];


 record(data:any){

  this.usage.push(data);

  return {
   recorded:true
  };

 }


 getUsage(){

  return this.usage;

 }

}
