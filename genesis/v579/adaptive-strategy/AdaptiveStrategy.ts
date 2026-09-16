export class AdaptiveStrategy {
  adapt(environment:any){
    return {
      environment,
      adaptation:true
    };
  }
}
