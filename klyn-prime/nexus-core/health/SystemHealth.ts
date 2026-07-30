export class SystemHealth {


 private online:boolean=false;


 initialize(){

  this.online=true;

 }



 status(){

  return {

   online:this.online,

   uptime:process.uptime(),

   memory:
   process.memoryUsage()

  };

 }



}
