export class MetaLearningEngine {

  strategies:any[]=[];

  register(strategy:any){
    this.strategies.push(strategy);
  }

  select(context:any){

    return {
      selected:true,
      context,
      strategy:this.strategies[0]
    };
  }
}
