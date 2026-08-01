export class GlobalProblemSolver {

  solve(problem:string){
    return {
      input: problem,
      phases:[
        "understanding",
        "architecture",
        "implementation",
        "verification"
      ]
    };
  }
}
