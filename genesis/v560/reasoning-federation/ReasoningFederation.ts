export class ReasoningFederation {
  reason(problem:string){
    return {
      problem,
      reasoning:"federated"
    };
  }
}
