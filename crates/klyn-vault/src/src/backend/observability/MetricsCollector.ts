export class MetricsCollector {

 private metrics:Record<string,number>={};


 record(
  name:string,
  value:number
 ){

  this.metrics[name]=value;

 }


 snapshot(){

  return this.metrics;

 }

}
