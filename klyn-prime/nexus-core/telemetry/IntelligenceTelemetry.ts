interface Event {

 name:string;

 data:any;

 timestamp:number;

}



export class IntelligenceTelemetry {


 private events:Event[];



 constructor(){

  this.events=[];

 }



 record(
  name:string,
  data:any
 ){

  this.events.push({

   name,

   data,

   timestamp:Date.now()

  });


 }



 snapshot(){

  return {

   total:this.events.length,

   recent:
   this.events.slice(-10)

  };

 }



}
