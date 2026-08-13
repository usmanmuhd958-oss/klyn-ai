export class StartupSequence {

  private steps:string[] = [];

  add(step:string){
    this.steps.push(step);
  }

  execute(){

    return {
      executed:true,
      steps:this.steps
    };

  }
}
