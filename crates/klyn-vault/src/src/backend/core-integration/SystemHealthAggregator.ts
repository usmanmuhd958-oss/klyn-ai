export class SystemHealthAggregator {

 check(){

  return {

   status:"HEALTHY",

   timestamp:Date.now()

  };

 }

}
