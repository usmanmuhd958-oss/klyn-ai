export class AgentExperienceMemory {
  remember(event:string){
    return {
      status:"remembered",
      event
    };
  }
}
