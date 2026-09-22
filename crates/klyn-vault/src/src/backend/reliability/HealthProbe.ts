export class HealthProbe {

 check(){

  return {
   status:"HEALTHY",
   timestamp:Date.now()
  };

 }

}
