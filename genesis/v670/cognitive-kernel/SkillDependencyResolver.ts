export class SkillDependencyResolver {
  resolve(skill:string){
    return {
      status:"resolved",
      skill
    };
  }
}
