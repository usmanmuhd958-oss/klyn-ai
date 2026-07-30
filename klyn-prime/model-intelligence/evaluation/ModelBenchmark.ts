export interface BenchmarkResult {
  model:string;
  task:string;
  accuracy:number;
  speed:number;
  cost:number;
  reliability:number;
}


export class ModelBenchmark {

  private results: BenchmarkResult[] = [];


  record(result:BenchmarkResult){

    this.results.push(result);

  }


  getBestModel(){

    return this.results.sort(
      (a,b)=>
      (b.accuracy+b.reliability)
      -
      (a.accuracy+a.reliability)

    )[0];

  }


  history(){

    return this.results;

  }

}
