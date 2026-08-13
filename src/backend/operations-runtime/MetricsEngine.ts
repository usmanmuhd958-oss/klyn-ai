export class MetricsEngine {

  private metrics:any[]=[];


  record(metric:any){

    this.metrics.push(metric);

  }


  collect(){

    return this.metrics;

  }

}
