export class AutonomousSkillAcquisition {
  acquire(skill:string){
    return {
      status:"acquired",
      skill
    };
  }
}
