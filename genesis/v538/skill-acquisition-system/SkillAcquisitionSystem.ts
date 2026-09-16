export class SkillAcquisitionSystem {

  skills:any[]=[];

  acquire(skill:any){

    this.skills.push(skill);

    return {
      acquired:true,
      skill
    };
  }
}
