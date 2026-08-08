export class AgentQueue {

  private tasks:any[] = [];

  push(task:any){
    this.tasks.push(task);
  }

  pop(){
    return this.tasks.shift();
  }

  pending(){
    return this.tasks.length;
  }

}
