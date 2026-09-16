export class SkillExecutionRouter {
  route(skill:string){
    return {
      status:"routed",
      skill
    };
  }
}
