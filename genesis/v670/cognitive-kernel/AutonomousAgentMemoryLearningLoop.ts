export class AutonomousAgentMemoryLearningLoop {

  memories:any[] = [];

  record(experience:string){
    this.memories.push(experience);
    return this.memories;
  }

}
