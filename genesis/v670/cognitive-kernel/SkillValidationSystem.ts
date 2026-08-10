export class SkillValidationSystem {
  validate(skill:string){
    return {
      status:"validated",
      skill
    };
  }
}
